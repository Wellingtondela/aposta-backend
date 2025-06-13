const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
const { MercadoPagoConfig } = require('mercadopago');
const moment = require('moment-timezone');


const app = express();
const port = process.env.PORT || 3000;

const fetch = global.fetch;

const mpAccessToken = process.env.MP_ACCESS_TOKEN || 'APP_USR-8788773395916849-053008-25d39705629784593abde20b15d8fb2f-568286023';

// Inicializa o Mercado Pago
const client = new MercadoPagoConfig({ accessToken: mpAccessToken });

app.use(cors());
app.use(bodyParser.json());

app.post('/api/enviar-whatsapp', async (req, res) => {
  const { telefone, mensagem } = req.body;

  const url = 'https://api.z-api.io/instances/3E29C2597A1D301A33CE4A39F5505F78/token/4DCAC74817C5D21367293CA0/send-text';
  const SEU_CLIENT_TOKEN = 'F090ddb41867c492182e527b79329c3c1S';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': SEU_CLIENT_TOKEN
      },
      body: JSON.stringify({
        phone: telefone,
        message: mensagem
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(400).json({ error: errorData });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rota raiz para teste básico
app.get('/', (req, res) => {
  res.send('Backend está rodando! Use /jogos-hoje para ver os jogos do dia.');
});

// ✅ Criar pagamento PIX
app.post('/criar-pagamento', async (req, res) => {
  const { aposta, telefone, valor } = req.body;

  if (!aposta || !telefone || !valor) {
    return res.status(400).json({ erro: 'Aposta, telefone e valor são obrigatórios.' });
  }

  try {
    const idempotencyKey = Date.now().toString();

    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mpAccessToken}`,
        'X-Idempotency-Key': idempotencyKey
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
      console.error('❌ Erro no retorno do Mercado Pago:', data);
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

// ✅ Webhook Mercado Pago
app.post('/webhook', async (req, res) => {
  const data = req.body;

  try {
    if (data.type === 'payment' && data.data?.id) {
      const paymentId = data.data.id;

      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${mpAccessToken}`
        }
      });

      const payment = await response.json();

      if (payment.status === 'approved') {
        const { external_reference, transaction_amount } = payment;

        let info = { aposta: '', telefone: '' };
        try {
          info = JSON.parse(external_reference);
        } catch (e) {
          console.warn('⚠️ Erro ao converter external_reference:', e);
        }

        await admin.firestore().collection('apostas').add({
          aposta: info.aposta,
          telefone: info.telefone,
          valor: transaction_amount,
          status: payment.status,
          payment_id: payment.id,
          data_pagamento: new Date()
        });

        console.log(`✅ Pagamento aprovado e salvo no Firestore para: ${info.telefone}`);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.sendStatus(500);
  }
});

// ✅ Consultar status de pagamento
app.get('/status-pagamento/:paymentId', async (req, res) => {
  const { paymentId } = req.params;
  try {
    const apostasRef = admin.firestore().collection('apostas');

    // CONVERSÃO para número
    const snapshot = await apostasRef
      .where('payment_id', '==', Number(paymentId))
      .get();

    if (snapshot.empty) {
      return res.json({ status: 'pending' });
    }

    let status = 'pending';
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === 'approved') {
        status = 'approved';
      }
    });

    return res.json({ status });

  } catch (error) {
    console.error('Erro ao consultar status:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ✅ Inicia o servidor
app.listen(port, () => {
  console.log(`✅ Servidor rodando na porta ${port}`);
});