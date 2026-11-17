'use strict';

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode'); // Modificado para generar imagen web
const cors = require('cors');     // Necesario para conectar con InfinityFree
const path = require('path');

const app = express();

app.use(cors()); // Habilita conexiones desde tu panel
app.use(express.json({ limit: '20kb' }));

// ESTADO DE WHATSAPP
let whatsappListo = false;
let estadoWhatsapp = 'iniciando';
let qrActual = ''; // Aquí guardaremos la imagen del QR

// CONFIGURACIÓN DEL CLIENTE
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: process.env.WWEBJS_AUTH_PATH || path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Obliga a usar disco en vez de RAM compartida
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions', // Apaga cualquier extensión innecesaria
            '--disable-software-rasterizer',
            '--mute-audio', // Apaga el sistema de sonido
            '--js-flags="--max-old-space-size=256"' // Obliga a Chrome a limpiar su memoria constantemente
        ]
    }
});

// GENERAR QR (Para mostrarlo en tu panel)
client.on('qr', async (qr) => {
    whatsappListo = false;
    estadoWhatsapp = 'esperando_qr';
    
    // Convertimos el QR a una imagen Base64 para enviarla a tu panel PHP
    qrActual = await qrcode.toDataURL(qr);
    console.log('📱 QR generado y listo para enviarse a la web.');
});

// WHATSAPP AUTENTICADO
client.on('authenticated', () => {
    estadoWhatsapp = 'autenticado';
    qrActual = ''; // Borramos el QR porque ya se vinculó
    console.log('🔐 WhatsApp autenticado.');
});

// WHATSAPP LISTO
client.on('ready', () => {
    whatsappListo = true;
    estadoWhatsapp = 'conectado';
    qrActual = '';
    console.log('✅ WhatsApp conectado correctamente.');
});

// ERROR DE AUTENTICACIÓN
client.on('auth_failure', (error) => {
    whatsappListo = false;
    estadoWhatsapp = 'error_autenticacion';
    console.error('❌ Error de autenticación:', error);
});

// DESCONEXIÓN
client.on('disconnected', (razon) => {
    whatsappListo = false;
    estadoWhatsapp = 'desconectado';
    qrActual = '';
    console.error('⚠️ WhatsApp desconectado:', razon);
    
    // Si se desconecta, reiniciamos para generar un nuevo QR
    client.initialize(); 
});

// CONSULTAR ESTADO DE LA API (Este lo leerá tu CRM en InfinityFree)
app.get('/', (req, res) => {
    res.json({
        api: 'online',
        whatsapp: estadoWhatsapp,
        qr: qrActual
    });
});

// ENDPOINT PARA ENVIAR MENSAJES (Sin Password, como pediste)
app.post('/enviar', async (req, res) => {
    const { numero, mensaje } = req.body || {};

    // VALIDAR DATOS
    if (numero == null || typeof mensaje !== 'string' || !mensaje.trim()) {
        return res.status(400).json({ status: 'error', message: 'Debe proporcionar número y mensaje.' });
    }

    // VERIFICAR WHATSAPP
    if (!whatsappListo) {
        return res.status(503).json({
            status: 'error',
            message: 'WhatsApp todavía no está conectado.',
            whatsapp: estadoWhatsapp
        });
    }

    // LIMPIAR NÚMERO
    const numeroLimpio = String(numero).replace(/\D/g, '');
    const numeroFinal = numeroLimpio.length === 10 ? `52${numeroLimpio}` : numeroLimpio;

    // VALIDAR FORMATO
    if (!/^\d{11,15}$/.test(numeroFinal)) {
        return res.status(400).json({ status: 'error', message: 'Número inválido. Incluya código de país.' });
    }

    try {
        const chatId = `${numeroFinal}@c.us`;
        await client.sendMessage(chatId, mensaje.trim());
        console.log(`✅ Mensaje enviado a ${numeroFinal}`);
        return res.status(200).json({ status: 'ok', message: `Mensaje enviado a ${numeroFinal}` });
    } catch (error) {
        console.error('❌ Error enviando mensaje:', error);
        return res.status(500).json({ status: 'error', message: 'No se pudo enviar el mensaje.' });
    }
});

// INICIAR SERVIDOR
const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API corriendo en el puerto ${PORT}`);
});

// INICIAR CLIENTE DE WHATSAPP
client.initialize().catch((error) => {
    whatsappListo = false;
    estadoWhatsapp = 'error_inicializacion';
    console.error('❌ Error al iniciar WhatsApp:', error);
    server.close(() => { process.exit(1); });
});

// CIERRE CONTROLADO
process.on('SIGTERM', async () => {
    console.log('⚠️ Cerrando servicio...');
    whatsappListo = false;
    try { await client.destroy(); } catch (error) { console.error('Error al cerrar WhatsApp:', error.message); }
    server.close(() => { process.exit(0); });
});