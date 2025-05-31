const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
const port = process.env.PORT || 3000;

// Configurar Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-8788773395916849-053008-25d39705629784593abde20b15d8fb2f-568286023'  // Substitua aqui se for testar local
});

app.use(cors());
app.use(bodyParser.json());

app.post('/criar-pagamento', async (req, res) => {
  const { aposta, telefone, valor } = req.body;

  if (!aposta || !telefone || !valor) {
    return res.status(400).json({ erro: 'Aposta, telefone e valor são obrigatórios.' });
  }

  try {
    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN || 'APP_USR-8788773395916849-053008-25d39705629784593abde20b15d8fb2f-568286023'}`
      },
      body: JSON.stringify({
        transaction_amount: parseFloat(valor),
        description: `Aposta: ${aposta}`,
        payment_method_id: 'pix',
        payer: {
          email: `${telefone.replace(/\D/g, '')}@apostas.com`,
          first_name: 'Apostador',
          last_name: telefone
        },
        external_reference: JSON.stringify({ aposta, telefone })
      })
    });

    const data = await response.json();

    if (!data.point_of_interaction) {
      throw new Error('Erro ao obter informações de pagamento.');
    }

    res.json({
      qr_code_base64: data.point_of_interaction.transaction_data.qr_code_base64,
      qr_code: data.point_of_interaction.transaction_data.qr_code,
      payment_id: data.id
    });

  } catch (error) {
    console.error('❌ Erro ao gerar pagamento PIX:', error);
    res.status(500).json({ erro: 'Erro ao gerar pagamento PIX.', detalhes: error.message });
  }
});

app.post('/webhook', async (req, res) => {
  const data = req.body;

  try {
    if (data.type === 'payment' && data.data && data.data.id) {
      const paymentId = data.data.id;

      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN || 'APP_USR-8788773395916849-053008-25d39705629784593abde20b15d8fb2f-568286023'}`
        }
      });

      const payment = await response.json();

      if (payment.status === 'approved') {
        const { external_reference, transaction_amount } = payment;

        let info = { aposta: '', telefone: '' };
        try {
          info = JSON.parse(external_reference);
        } catch (e) {}

        const docRef = admin.firestore().collection('apostas').doc();

        await docRef.set({
          aposta: info.aposta,
          telefone: info.telefone,
          valor: transaction_amount,
          status: payment.status,
          data_pagamento: new Date()
        });

        console.log(`✅ Pagamento aprovado e aposta salva para ${info.telefone}`);
      }
    }

    res.sendStatus(200); // Mercado Pago espera 200 para confirmar o recebimento

  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`✅ Servidor rodando na porta ${port}`);
});
