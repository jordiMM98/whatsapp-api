'use strict';

const express = require('express');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const cors = require('cors');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50kb' }));

// VARIABLES GLOBALES
let estadoWhatsapp = 'iniciando';
let qrActual = '';
let sock = null;
let mensajesPendientes = [];
let idsProcesados = new Set(); // Evita procesar dos veces el mismo mensaje

async function conectarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['CRM Congregacion', 'Chrome', '1.0.0'],
        syncFullHistory: false // Mantiene la RAM baja al no descargar historial viejo
    });

    sock.ev.on('creds.update', saveCreds);

    // MONITOREO DE CONEXIÓN
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            estadoWhatsapp = 'esperando_qr';
            qrActual = await qrcode.toDataURL(qr);
            console.log('📱 Nuevo código QR generado.');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const debeReconectar = statusCode !== DisconnectReason.loggedOut;

            estadoWhatsapp = 'desconectado';
            qrActual = '';
            console.log(`⚠️ Conexión cerrada (Código: ${statusCode}). Reconectando: ${debeReconectar}`);

            if (debeReconectar) {
                setTimeout(conectarWhatsApp, 3000);
            } else {
                console.log('❌ Sesión cerrada manualmente. Esperando nuevo escaneo.');
                setTimeout(conectarWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            estadoWhatsapp = 'conectado';
            qrActual = '';
            console.log('✅ WhatsApp conectado y listo.');
        }
    });

    // SINCRONIZACIÓN DE MENSAJES (ENTRANTES Y SALIENTES DESDE APP)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const msgId = msg.key.id;
            if (idsProcesados.has(msgId)) continue; // Si ya se procesó, lo saltamos
            idsProcesados.add(msgId);

            // Limpiar el historial de IDs en memoria si crece mucho
            if (idsProcesados.size > 500) {
                const primerId = idsProcesados.values().next().value;
                idsProcesados.delete(primerId);
            }

            const remoteJid = msg.key.remoteJid;
            // Ignorar estados, grupos y canales
            if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@newsletter')) {
                continue;
            }

            // Extraer texto o identificar si enviaron imagen/audio
            let texto = msg.message.conversation ||
                        msg.message.extendedTextMessage?.text ||
                        msg.message.imageMessage?.caption ||
                        msg.message.videoMessage?.caption ||
                        '';

            if (!texto) {
                if (msg.message.imageMessage) texto = '📷 [Imagen enviada]';
                else if (msg.message.audioMessage) texto = '🎵 [Nota de voz]';
                else if (msg.message.videoMessage) texto = '🎥 [Video]';
                else if (msg.message.documentMessage) texto = '📄 [Documento]';
                else if (msg.message.stickerMessage) texto = '💟 [Sticker]';
                else continue;
            }

            const numero = remoteJid.split('@')[0];
            const esMio = Boolean(msg.key.fromMe);
            const nombre = esMio ? 'Yo (App)' : (msg.pushName || numero);
            const tipo = esMio ? 'enviado' : 'recibido';

            console.log(`💬 [${tipo.toUpperCase()}] ${nombre} (${numero}): ${texto}`);

            mensajesPendientes.push({
                id_wa: msgId,
                telefono: numero,
                nombre: nombre,
                mensaje: texto,
                tipo: tipo
            });
        }
    });
}

conectarWhatsApp();

// ENDPOINT 1: ESTADO DE LA API
app.get('/', (req, res) => {
    res.json({
        api: 'online',
        whatsapp: estadoWhatsapp,
        qr: qrActual,
        pendientes: mensajesPendientes.length
    });
});

// ENDPOINT 2: ENTREGAR MENSAJES PENDIENTES AL FRONTEND
app.get('/recibir-nuevos', (req, res) => {
    const lote = [...mensajesPendientes];
    mensajesPendientes = [];
    res.json(lote);
});

// ENDPOINT 3: ENVIAR MENSAJE DESDE LA WEB
app.post('/enviar', async (req, res) => {
    const { numero, mensaje } = req.body || {};

    if (!numero || typeof mensaje !== 'string' || !mensaje.trim()) {
        return res.status(400).json({ status: 'error', message: 'Número o mensaje inválido.' });
    }

    if (estadoWhatsapp !== 'conectado' || !sock) {
        return res.status(503).json({ status: 'error', message: 'El servidor no está conectado a WhatsApp.' });
    }

    let numLimpio = String(numero).replace(/\D/g, '');
    if (numLimpio.length === 10) {
        numLimpio = '521' + numLimpio; // Formato estándar móvil México
    }

    try {
        // Verificar en WhatsApp cuál es el JID exacto del número (resuelve problemas de 52 vs 521)
        const [resultado] = await sock.onWhatsApp(numLimpio);
        const jidDestino = resultado?.jid || `${numLimpio}@s.whatsapp.net`;

        const enviado = await sock.sendMessage(jidDestino, { text: mensaje.trim() });
        
        // Guardamos el ID de este envío para que el listener no lo vuelva a mandar como duplicado
        if (enviado?.key?.id) {
            idsProcesados.add(enviado.key.id);
        }

        console.log(`✅ Enviado a ${jidDestino}: ${mensaje.trim()}`);
        return res.status(200).json({ status: 'ok', jid: jidDestino });
    } catch (error) {
        console.error('❌ Error al enviar por Baileys:', error);
        return res.status(500).json({ status: 'error', message: error.message || 'Fallo interno al enviar.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Baileys activo en puerto ${PORT}`);
});