const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
const mercadopago = require('mercadopago');

const app = express();
const port = process.env.PORT || 3000;

// Configure o access_token
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN || 'SEU_ACCESS_TOKEN'
});

app.use(cors());
app.use(bodyParser.json());

app.post('/criar-pagamento', async (req, res) => {
  const { aposta, telefone, valor } = req.body;

  if (!aposta || !telefone || !valor) {
    return res.status(400).json({ erro: 'Aposta, telefone e valor são obrigatórios.' });
  }

  try {
    const preference = {
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
    };

    const response = await mercadopago.preferences.create(preference);

    res.json({
      id: response.body.id,
      init_point: response.body.init_point
    });

  } catch (error) {
    console.error('Erro ao criar pagamento:', error);
    res.status(500).json({ erro: 'Erro ao criar pagamento.', detalhes: error.message });
  }
});

// webhook...

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
