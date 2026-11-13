const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

// Configuración del cliente de WhatsApp con argumentos optimizados para Render
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// Generar el código QR en la terminal
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('☝️ Escanea este código QR con tu WhatsApp.');
});

client.on('ready', () => {
    console.log('✅ Cliente de WhatsApp conectado y listo.');
});

client.initialize();

// Endpoint que tu PHP va a consumir
app.post('/enviar', async (req, res) => {
    const { numero, mensaje, password } = req.body;

    // Verificar contraseña
    if (password !== 'Jordi2026!') {
        console.log('Intento de acceso denegado (Contraseña incorrecta).');
        return res.status(401).json({ error: 'No autorizado. Contraseña incorrecta.' });
    }

    if (!numero || !mensaje) {
        return res.status(400).json({ error: 'Falta número o mensaje' });
    }

    // Formato de WhatsApp: Código de país (52 para México) + número + @c.us
    const chatId = `${numero}@c.us`;

    try {
        await client.sendMessage(chatId, mensaje);
        res.status(200).json({ status: 'ok', message: 'Mensaje enviado a ' + numero });
    } catch (error) {
        console.error('Error enviando mensaje:', error);
        res.status(500).json({ status: 'error', message: error.toString() });
    }
});

// Iniciar el servidor web
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API corriendo en el puerto ${PORT}`);
});