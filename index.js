'use strict';

const express = require('express');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const cors = require('cors');
const pino = require('pino'); // Necesario para silenciar los logs internos de Baileys

const app = express();
app.use(cors());
app.use(express.json({ limit: '20kb' }));

// VARIABLES DE ESTADO
let estadoWhatsapp = 'iniciando';
let qrActual = '';
let sock; // Aquí vivirá nuestra conexión súper ligera

async function conectarWhatsApp() {
    // Baileys guarda la sesión en una carpeta llamada 'baileys_auth_info'
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // Apagamos el texto basura en los logs de Render
        browser: ['API Congregacion', 'Chrome', '1.0.0']
    });

    // Guardar credenciales automáticamente
    sock.ev.on('creds.update', saveCreds);

    // Escuchar eventos de la conexión (QR, desconexión, éxito)
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            estadoWhatsapp = 'esperando_qr';
            qrActual = await qrcode.toDataURL(qr);
            console.log('📱 QR generado y listo para enviarse al panel PHP.');
        }

        if (connection === 'close') {
            const code = lastDisconnect.error?.output?.statusCode;
            const reconectar = code !== DisconnectReason.loggedOut;
            
            estadoWhatsapp = 'desconectado';
            qrActual = '';
            
            console.log('⚠️ Conexión cerrada. Código:', code);

            if (reconectar) {
                console.log('🔄 Reconectando automáticamente en 3 segundos...');
                setTimeout(conectarWhatsApp, 3000);
            } else {
                console.log('❌ Sesión cerrada por el usuario. Se pedirá un nuevo QR.');
                setTimeout(conectarWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            estadoWhatsapp = 'conectado';
            qrActual = '';
            console.log('✅ WhatsApp conectado exitosamente sin usar Chrome (RAM a salvo).');
        }
    });
}

// Iniciar el ciclo de conexión
conectarWhatsApp();

// ENDPOINT 1: Consultar estado (Tu página PHP lee esto)
app.get('/', (req, res) => {
    res.json({
        api: 'online',
        whatsapp: estadoWhatsapp,
        qr: qrActual
    });
});

// ENDPOINT 2: Enviar Mensajes
app.post('/enviar', async (req, res) => {
    const { numero, mensaje } = req.body || {};

    if (!numero || typeof mensaje !== 'string' || !mensaje.trim()) {
        return res.status(400).json({ status: 'error', message: 'Falta número o mensaje.' });
    }

    if (estadoWhatsapp !== 'conectado') {
        return res.status(503).json({ status: 'error', message: 'WhatsApp no está conectado.', whatsapp: estadoWhatsapp });
    }

    const numeroLimpio = String(numero).replace(/\D/g, '');
    const numeroFinal = numeroLimpio.length === 10 ? `52${numeroLimpio}` : numeroLimpio;
    
    // Baileys usa el sufijo @s.whatsapp.net (Diferente a la otra librería)
    const jid = `${numeroFinal}@s.whatsapp.net`;

    try {
        // Enviar el mensaje
        await sock.sendMessage(jid, { text: mensaje.trim() });
        console.log(`✅ Mensaje enviado a ${numeroFinal}`);
        return res.status(200).json({ status: 'ok', message: `Mensaje enviado a ${numeroFinal}` });
    } catch (error) {
        console.error('❌ Error enviando mensaje:', error);
        return res.status(500).json({ status: 'error', message: 'No se pudo enviar el mensaje.' });
    }
});

// Levantar el servidor web
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor súper ligero corriendo en el puerto ${PORT}`);
});