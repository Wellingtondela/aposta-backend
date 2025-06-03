const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
const { MercadoPagoConfig } = require('mercadopago');

const app = express();
const port = process.env.PORT || 3000;

const fetch = global.fetch;

const mpAccessToken = process.env.MP_ACCESS_TOKEN || 'APP_USR-8788773395916849-053008-25d39705629784593abde20b15d8fb2f-568286023';

// Inicializa o Mercado Pago
const client = new MercadoPagoConfig({ accessToken: mpAccessToken });

app.use(cors());
app.use(bodyParser.json());

// Rota raiz para teste básico
app.get('/', (req, res) => {
  res.send('Backend está rodando! Use /jogos-hoje para ver os jogos do dia.');
});

// Rota para buscar jogos do dia via SportMonks
app.get('/jogos-hoje', async (req, res) => {
  const API_TOKEN = process.env.SPORTMONKS_TOKEN;
  const hoje = new Date().toISOString().split('T')[0];

  try {
    // 🔎 1. Buscar ligas permitidas no seu plano
    const ligasResponse = await fetch(`https://api.sportmonks.com/v3/football/leagues?api_token=${API_TOKEN}`);
    const ligasData = await ligasResponse.json();

    if (!ligasData.data) {
      console.log('❌ Não foi possível obter as ligas disponíveis:', ligasData);
      return res.status(500).json({ erro: 'Erro ao consultar ligas disponíveis.' });
    }

    // 🧠 2. Extrair os IDs das ligas permitidas
    const ligasPermitidas = ligasData.data.map(league => league.id);

    // ✅ 3. Consultar os jogos do dia com as ligas liberadas
    const fixturesURL = `https://api.sportmonks.com/v3/football/fixtures/date/${hoje}?api_token=${API_TOKEN}&leagues=${ligasPermitidas.join(',')}&include=participants;league`;

    const jogosResponse = await fetch(fixturesURL);
    const jogosData = await jogosResponse.json();

    if (!jogosData.data || jogosData.data.length === 0) {
      console.log('⚠️ Nenhum jogo encontrado para hoje.');
      return res.json({ jogos: [] }); // Resposta vazia, mas sem erro
    }

    // 🏟️ 4. Transformar dados para o formato desejado
    const jogos = jogosData.data.map(jogo => {
      const localTeam = jogo.participants?.find(p => p.meta?.location === 'home');
      const visitorTeam = jogo.participants?.find(p => p.meta?.location === 'away');

      return {
        id: jogo.id,
        campeonato: jogo.league?.name || 'Desconhecido',
        pais: jogo.league?.country?.name || 'Desconhecido',
        timeCasa: localTeam?.name || 'Desconhecido',
        timeFora: visitorTeam?.name || 'Desconhecido',
        horario: jogo.starting_at?.timestamp
          ? new Date(jogo.starting_at.timestamp * 1000).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit'
            })
          : '00:00'
      };
    });

    return res.json({ jogos });

  } catch (error) {
    console.error('❌ Erro ao buscar jogos do dia:', error.message);
    res.status(500).json({ erro: 'Erro ao buscar jogos do dia' });
  }
});

app.get('/ligas-disponiveis', async (req, res) => {
  const API_TOKEN = process.env.SPORTMONKS_TOKEN;

  try {
    const response = await fetch(`https://api.sportmonks.com/v3/football/leagues?api_token=${API_TOKEN}`);
    const data = await response.json();

    if (!data.data) {
      return res.status(500).json({ erro: 'Erro ao buscar ligas.' });
    }

    const ligas = data.data.map(league => ({
      id: league.id,
      nome: league.name,
      pais: league.country?.name || 'Desconhecido'
    }));

    res.json({ ligas });
  } catch (error) {
    console.error('Erro ao buscar ligas:', error.message);
    res.status(500).json({ erro: 'Erro interno' });
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
