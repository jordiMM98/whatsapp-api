const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

// Configuración del cliente de WhatsApp
// El argumento --no-sandbox es OBLIGATORIO para que funcione en servidores gratuitos como Render
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
    const { numero, mensaje } = req.body;

    if (!numero || !mensaje) {
        return res.status(400).json({ error: 'Falta número o mensaje' });
    }

    // Formato de WhatsApp: Código de país (52 para México) + número + @c.us
    // Ejemplo: 5215512345678@c.us
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