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
    const preference = new Preference(client);

    const result = await preference.create({
      body: {
        items: [
          {
            title: `Aposta: ${aposta}`,
            quantity: 1,
            unit_price: parseFloat(valor)
          }
        ],
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

    if (!result || !result.body || !result.body.id) {
      throw new Error('Resposta inválida da API do Mercado Pago.');
    }

    res.json({
      id: result.body.id,
      init_point: result.body.init_point
    });

  } catch (error) {
    console.error('❌ Erro ao criar pagamento:', error);
    res.status(500).json({ erro: 'Erro ao criar pagamento.', detalhes: error.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Servidor rodando na porta ${port}`);
});
