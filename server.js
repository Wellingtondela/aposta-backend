const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
const mercadopago = require('mercadopago');

const app = express();
const port = process.env.PORT || 3000;

// Configurações
app.use(cors());
app.use(bodyParser.json());

// 🔐 Configure o Mercado Pago com seu Access Token
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN || 'SEU_ACCESS_TOKEN_AQUI'
});

// 🔄 Rota de teste
app.get('/', (req, res) => {
  res.send('Servidor de apostas rodando!');
});

// 🚀 Gera pagamento e retorna QR Code + "copie e cole"
app.post('/gerar-pagamento', async (req, res) => {
  const { aposta, telefone } = req.body;

  if (!aposta || !telefone) {
    return res.status(400).json({ erro: 'Aposta e telefone são obrigatórios.' });
  }

  try {
    const payment = await mercadopago.payment.create({
      transaction_amount: 1.00, // valor fixo por enquanto
      description: `Aposta do telefone ${telefone}`,
      payment_method_id: 'pix',
      payer: {
        email: `${telefone}@wsaaposta.com`,
        first_name: 'Apostador'
      }
    });

    const pagamentoId = payment.body.id;

    // Salva a aposta como pendente
    await admin.firestore().collection('apostas_pendentes').doc(pagamentoId.toString()).set({
      aposta,
      telefone,
      status: 'pendente',
      pagamentoId,
      criado_em: admin.firestore.FieldValue.serverTimestamp()
    });

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

// ✅ Webhook para verificar o pagamento (configure a URL no Mercado Pago)
app.post('/webhook', async (req, res) => {
  const paymentId = req.body.data?.id;

  try {
    const payment = await mercadopago.payment.findById(paymentId);

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

        await docRef.delete(); // Remove da lista de pendentes
        console.log(`Aposta do telefone ${telefone} salva com sucesso após pagamento aprovado.`);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
