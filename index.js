'use strict';

const express = require('express');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const cors = require('cors');
const pino = require('pino'); 

const app = express();
app.use(cors());
app.use(express.json({ limit: '20kb' }));

let estadoWhatsapp = 'iniciando';
let qrActual = '';
let sock; 
let mensajesPendientes = []; // CAJITA TEMPORAL PARA GUARDAR MENSAJES

async function conectarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), 
        browser: ['API Congregacion', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            estadoWhatsapp = 'esperando_qr';
            qrActual = await qrcode.toDataURL(qr);
        }

        if (connection === 'close') {
            const code = lastDisconnect.error?.output?.statusCode;
            const reconectar = code !== DisconnectReason.loggedOut;
            estadoWhatsapp = 'desconectado';
            qrActual = '';
            
            if (reconectar) {
                setTimeout(conectarWhatsApp, 3000);
            } else {
                setTimeout(conectarWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            estadoWhatsapp = 'conectado';
            qrActual = '';
            console.log('✅ WhatsApp conectado exitosamente.');
        }
    });

    // ==========================================
    // ESCUCHAR MENSAJES Y METERLOS A LA CAJITA
    // ==========================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return; 
        
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return; 
        
        const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const numero = msg.key.remoteJid.split('@')[0];
        const nombre = msg.pushName || "Desconocido";

        if (texto) {
            console.log(`📩 Nuevo mensaje de ${nombre}: ${texto}`);
            // Guardamos en la memoria temporal en vez de usar fetch
            mensajesPendientes.push({ telefono: numero, nombre: nombre, mensaje: texto });
        }
    });
}

conectarWhatsApp();

app.get('/', (req, res) => {
    res.json({ api: 'online', whatsapp: estadoWhatsapp, qr: qrActual });
});

// NUEVO ENDPOINT: El panel PHP llamará aquí para llevarse los mensajes
app.get('/recibir-nuevos', (req, res) => {
    res.json(mensajesPendientes);
    mensajesPendientes = []; // Vaciamos la cajita después de entregarlos
});

app.post('/enviar', async (req, res) => {
    const { numero, mensaje } = req.body || {};
    if (!numero || !mensaje) return res.status(400).json({ status: 'error' });
    if (estadoWhatsapp !== 'conectado') return res.status(503).json({ status: 'error' });

    const numeroFinal = String(numero).replace(/\D/g, '');
    const jid = `${numeroFinal.length === 10 ? '52'+numeroFinal : numeroFinal}@s.whatsapp.net`;

    try {
        await sock.sendMessage(jid, { text: mensaje.trim() });
        return res.status(200).json({ status: 'ok' });
    } catch (error) {
        return res.status(500).json({ status: 'error' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API corriendo en el puerto ${PORT}`);
});