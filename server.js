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


async function enviarMensagemWhatsApp(numero) {
  const instanceId = '3E23952117D550BCB9CDAE39331CC17C'; // seu instanceId
  const token = process.env.ZAPI_CLIENT_TOKEN; // seu token correto

  if (!token) {
    throw new Error('Client-Token não configurado');
  }

  // Formata o número para internacional, adiciona 55 se não existir
  let numeroLimpo = numero.replace(/\D/g, '');
  if (!numeroLimpo.startsWith('55')) {
    numeroLimpo = '55' + numeroLimpo;
  }

  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

  const body = {
    phone: numeroLimpo,
    message: "Olá, sua aposta foi confirmada!",
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Client-Token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Erro ao enviar mensagem Z-API:', data);
    throw new Error(data.error || 'Erro desconhecido ao enviar mensagem');
  }

  console.log('Mensagem enviada com sucesso:', data);
  return data;
}



app.post('/enviar-whatsapp', async (req, res) => {
  const { numero, paymentId } = req.body;

  if (!numero || !paymentId) {
    return res.status(400).json({ error: 'Número e paymentId são obrigatórios.' });
  }

  try {
    const mensagem = `Seu pagamento ${paymentId} foi aprovado com sucesso. Obrigado pela aposta!`;
    await enviarMensagemWhatsApp(numero, mensagem);
    return res.json({ sucesso: true });
  } catch (error) {
    console.error('Erro ao enviar WhatsApp:', error.message);
    return res.status(500).json({ error: 'Erro ao enviar WhatsApp.' });
  }
});

// Rota raiz para teste básico
app.get('/', (req, res) => {
  res.send('Backend está rodando! Use /jogos-hoje para ver os jogos do dia.');
});

const API_KEY = 'live_09bb6629160038527d05e70d0759ed';
const BASE_URL = 'https://v3.football.api-sports.io';

app.get('/jogos-hoje', async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];

    const response = await fetch(`${BASE_URL}/fixtures?date=${hoje}`, {
      headers: { 'x-apisports-key': API_KEY }
    });

    const data = await response.json();

    const jogos = await Promise.all(data.response.map(async (jogo) => {
      const fixtureId = jogo.fixture.id;

      let odds = [];
      try {
        const oddsRes = await fetch(`${BASE_URL}/odds?fixture=${fixtureId}`, {
          headers: { 'x-apisports-key': API_KEY }
        });
        const oddsData = await oddsRes.json();

        const bookmaker = oddsData.response?.[0]?.bookmakers?.[0];
        if (bookmaker?.bets?.[0]?.values) {
          odds = bookmaker.bets[0].values.map(opt => ({
            resultado: {
              Home: 'Casa',
              Draw: 'Empate',
              Away: 'Fora'
            }[opt.value] || opt.value,
            odd: opt.odd
          }));
        }
      } catch (err) {
        console.warn(`⚠️ Falha ao buscar odds para fixture ${fixtureId}:`, err.message);
      }

      return {
        id: fixtureId,
        campeonato: jogo.league.name,
        pais: jogo.league.country,
        timeCasa: jogo.teams.home.name,
        timeFora: jogo.teams.away.name,
        horario: new Date(jogo.fixture.date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        odds
      };
    }));

    res.json({ jogos });
  } catch (error) {
    console.error('Erro ao buscar jogos:', error.message);
    res.status(500).json({ error: 'Erro interno ao buscar jogos' });
  }
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

// Rota para consultar apostas pelo telefone
app.get('/consultar-apostas/:telefone', async (req, res) => {
  const telefone = req.params.telefone;

  // Validação simples do telefone (11 dígitos)
  if (!/^\d{11}$/.test(telefone)) {
    return res.status(400).json({ error: 'Telefone inválido. Deve conter 11 dígitos numéricos.' });
  }

  try {
    // Busca apostas onde o campo "telefone" seja igual ao telefone informado
    const apostasRef = admin.firestore().collection('apostas');

    const querySnapshot = await apostasRef.where('telefone', '==', telefone).get();

    if (querySnapshot.empty) {
      return res.status(404).json({ message: 'Nenhuma aposta encontrada para esse telefone.' });
    }

    const apostas = [];
    querySnapshot.forEach(doc => {
      apostas.push({ id: doc.id, ...doc.data() });
    });

    return res.json({ apostas });
  } catch (error) {
    console.error('Erro ao consultar apostas:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ✅ Inicia o servidor
app.listen(port, () => {
  console.log(`✅ Servidor rodando na porta ${port}`);
});