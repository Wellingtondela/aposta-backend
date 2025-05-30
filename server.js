const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
const { MercadoPago } = require('mercadopago');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// ✅ Configure com seu Access Token
const mp = new MercadoPago({
  accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-5389107324174320-081210-83ccf297a805164f8e0620976484fabe-568286023'
});

// 🚀 Criar pagamento (checkout PIX direto)
app.post('/criar-pagamento', async (req, res) => {
  const { aposta, telefone, valor } = req.body;

  if (!aposta || !telefone || !valor) {
    return res.status(400).json({ erro: 'Aposta, telefone e valor são obrigatórios.' });
  }

  try {
    const payment = await mp.payment.create({
      transaction_amount: parseFloat(valor),
      description: `Aposta: ${aposta}`,
      payment_method_id: 'pix',
      payer: {
        email: 'apostador@teste.com'
      },
      external_reference: JSON.stringify({ aposta, telefone }),
      notification_url: 'https://seusite.com/notificacao'
    });

    res.json({
      pagamentoId: payment.body.id,
      qr_code: payment.body.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: payment.body.point_of_interaction.transaction_data.qr_code_base64
    });

  } catch (err) {
    console.error('Erro ao criar pagamento:', err);
    res.status(500).json({ erro: 'Erro ao criar pagamento.' });
  }
});

// ✅ Webhook de notificação de pagamento (versão nova)
app.post('/notificacao', async (req, res) => {
  const paymentId = req.body.data?.id;

  try {
    const payment = await mp.payment.get(paymentId);

    if (payment.body.status === 'approved') {
      const { aposta, telefone } = JSON.parse(payment.body.external_reference);

      await admin.firestore().collection('apostas').add({
        aposta,
        telefone,
        status: 'pago',
        paymentId,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`💰 Aposta salva após pagamento aprovado: ${telefone}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro ao processar notificação:', error);
    res.status(500).send('Erro ao processar notificação');
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
