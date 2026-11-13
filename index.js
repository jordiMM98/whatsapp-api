// Configuración del cliente de WhatsApp
// El argumento --no-sandbox es OBLIGATORIO para que funcione en servidores gratuitos como Render
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, // <--- Agrega esto
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // <--- Agrega esto
            '--disable-accelerated-2d-canvas', // <--- Agrega esto
            '--no-first-run', // <--- Agrega esto
            '--no-zygote', // <--- Agrega esto
            '--single-process', // <--- Agrega esto
            '--disable-gpu' // <--- Agrega esto
        ]
    }
});