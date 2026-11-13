
'use strict';

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

const app = express();

app.use(express.json({ limit: '20kb' }));

// ESTADO DE WHATSAPP
let whatsappListo = false;
let estadoWhatsapp = 'iniciando';

// CONFIGURACIÓN DEL CLIENTE
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: process.env.WWEBJS_AUTH_PATH ||
            path.join(__dirname, '.wwebjs_auth')
    }),

    puppeteer: {
        headless: true,

        ...(process.env.PUPPETEER_EXECUTABLE_PATH
            ? {
                executablePath:
                    process.env.PUPPETEER_EXECUTABLE_PATH
            }
            : {}),

        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--disable-gpu'
        ]
    }
});

// GENERAR QR
client.on('qr', (qr) => {
    whatsappListo = false;
    estadoWhatsapp = 'esperando_qr';

    console.log('📱 Escanee este QR con WhatsApp:');
    console.log('Dispositivos vinculados > Vincular dispositivo');

    qrcode.generate(qr, { small: true });
});

// WHATSAPP AUTENTICADO
client.on('authenticated', () => {
    estadoWhatsapp = 'autenticado';

    console.log('🔐 WhatsApp autenticado.');
});

// WHATSAPP LISTO
client.on('ready', () => {
    whatsappListo = true;
    estadoWhatsapp = 'conectado';

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

    console.error('⚠️ WhatsApp desconectado:', razon);
});

// CONSULTAR ESTADO DE LA API
app.get('/', (req, res) => {
    res.json({
        api: 'online',
        whatsapp: estadoWhatsapp
    });
});

// ENDPOINT PARA ENVIAR MENSAJES
app.post('/enviar', async (req, res) => {

    const { numero, mensaje } = req.body || {};

    // VALIDAR DATOS
    if (
        numero == null ||
        typeof mensaje !== 'string' ||
        !mensaje.trim()
    ) {
        return res.status(400).json({
            status: 'error',
            message: 'Debe proporcionar número y mensaje.'
        });
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

    // AGREGAR CÓDIGO DE MÉXICO SI TIENE 10 DÍGITOS
    const numeroFinal = numeroLimpio.length === 10
        ? `52${numeroLimpio}`
        : numeroLimpio;

    // VALIDAR FORMATO
    if (!/^\d{11,15}$/.test(numeroFinal)) {
        return res.status(400).json({
            status: 'error',
            message: 'Número inválido. Incluya código de país.'
        });
    }

    try {
        const chatId = `${numeroFinal}@c.us`;

        await client.sendMessage(
            chatId,
            mensaje.trim()
        );

        console.log(`✅ Mensaje enviado a ${numeroFinal}`);

        return res.status(200).json({
            status: 'ok',
            message: `Mensaje enviado a ${numeroFinal}`
        });

    } catch (error) {
        console.error('❌ Error enviando mensaje:', error);

        return res.status(500).json({
            status: 'error',
            message: 'No se pudo enviar el mensaje.'
        });
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

    server.close(() => {
        process.exit(1);
    });
});

// CIERRE CONTROLADO
process.on('SIGTERM', async () => {
    console.log('⚠️ Cerrando servicio...');

    whatsappListo = false;

    try {
        await client.destroy();
    } catch (error) {
        console.error('Error al cerrar WhatsApp:', error.message);
    }

    server.close(() => {
        process.exit(0);
    });
});
