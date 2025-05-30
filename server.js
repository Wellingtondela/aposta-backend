const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
const { MercadoPagoConfig } = require('mercadopago');

const app = express();
const port = process.env.PORT || 3000;

// 🔐 Configure seu access token aqui (ou use variável de ambiente)
const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-5389107324174320-081210-83ccf297a805164f8e0620976484fabe-568286023'
});

app.use(cors());
app.use(bodyParser.json());

// ✅ Criar pagamento
app.post('/criar-pagamento', async (req, res) => {
  const { aposta, telefone, valor } = req.body;

  if (!aposta || !telefone || !valor) {
    return res.status(400).json({ erro: 'Aposta, telefone e valor são obrigatórios.' });
  }

  try {
    const response = await mercadopago.preference.create({
      body: {
        items: [{
          title: `Aposta: ${aposta}`,
          unit_price: parseFloat(valor),
          quantity: 1
        }],
        external_reference: JSON.stringify({ aposta, telefone }),
        back_urls: {
          success: 'https://seusite.com/sucesso',
          failure: 'https://seusite.com/erro',
          pending: 'https://seusite.com/pendente'
        },
        auto_return: 'approved',
        notification_url: 'https://aposta-backend.onrender.com/webhook'
      }
    });

    res.json({
      id: response.id,
      init_point: response.init_point
    });

 } catch (error) {
  console.error('Erro ao criar pagamento:', error.response ? error.response : error);
  res.status(500).json({ erro: 'Erro ao criar pagamento.', detalhes: error.message });
}

});

// ✅ Webhook (notificação de pagamento)
app.post('/webhook', async (req, res) => {
  const { id, topic } = req.query;

  if (topic !== 'payment') return res.sendStatus(200);

  try {
    const payment = await mercadopago.payment.get({ id });

    if (payment.body.status === 'approved') {
      const { aposta, telefone } = JSON.parse(payment.body.external_reference);

      const db = admin.firestore();
      await db.collection('apostas').add({
        aposta,
        telefone,
        paymentId: id,
        status: 'pago',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`✅ Servidor rodando na porta ${port}`);
});
