const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
const mercadopago = require('mercadopago');

const app = express();
const port = process.env.PORT || 3000;

// ✅ Configura o Mercado Pago com Access Token da variável de ambiente
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

app.use(cors());
app.use(bodyParser.json());

// 🔄 Rota de teste
app.get('/', (req, res) => {
  res.send('Servidor de apostas rodando!');
});

// 🚀 Gera pagamento Pix e retorna QR Code + link "copie e cole"
app.post('/gerar-pagamento', async (req, res) => {
  const { aposta, telefone } = req.body;

  if (!aposta || !telefone) {
    return res.status(400).json({ erro: 'Aposta e telefone são obrigatórios.' });
  }

  try {
    const payment = await mercadopago.payment.create({
      body: {
        transaction_amount: 10,
        payment_method_id: "pix",
        payer: {
          email: "test_user_123@testuser.com"
        }
      }
    });

    const pagamentoId = payment.body.id;

    // 🔒 Salva a aposta como "pendente"
    await admin.firestore().collection('apostas_pendentes').doc(pagamentoId.toString()).set({
      aposta,
      telefone,
      status: 'pendente',
      pagamentoId,
      criado_em: admin.firestore.FieldValue.serverTimestamp()
    });

    // 🔁 Retorna o QR Code e o código de pagamento
    res.json({
      qr_code_base64: payment.body.point_of_interaction.transaction_data.qr_code_base64,
      qr_code: payment.body.point_of_interaction.transaction_data.qr_code,
      pagamentoId
    });
  } catch (err) {
    console.error('Erro ao gerar pagamento:', err);
    res.status(500).json({ erro: 'Erro ao gerar pagamento.' });
  }
});

// ✅ Webhook para receber notificações do Mercado Pago
app.post('/webhook', async (req, res) => {
  const paymentId = req.body.data?.id;

  try {
    const payment = await mercadopago.payment.get({ id: paymentId });

    if (payment.body.status === 'approved') {
      const docRef = admin.firestore().collection('apostas_pendentes').doc(paymentId.toString());
      const doc = await docRef.get();

      if (doc.exists) {
        const { aposta, telefone } = doc.data();

        await admin.firestore().collection('apostas').add({
          aposta,
          telefone,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        await docRef.delete(); // Remove das pendentes
        console.log(`✅ Aposta salva após pagamento aprovado: ${telefone}`);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.sendStatus(500);
  }
});

// 🔊 Inicializa o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
