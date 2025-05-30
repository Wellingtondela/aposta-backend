const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
const mercadopago = require('mercadopago');

const app = express();
const port = process.env.PORT || 3000;

// Configuração do Mercado Pago (substitua pela sua access_token)
mercadopago.configure({
  access_token: 'APP_USR-5389107324174320-081210-83ccf297a805164f8e0620976484fabe-568286023'
});

app.use(cors());
app.use(bodyParser.json());

// Rota para criar a preferência de pagamento
app.post('/criar-pagamento', async (req, res) => {
  const { aposta, telefone, valor } = req.body;

  if (!aposta || !telefone || !valor) {
    return res.status(400).json({ erro: 'Aposta, telefone e valor são obrigatórios.' });
  }

  try {
    // Cria a preferência de pagamento
    const preference = {
      items: [
        {
          title: `Aposta: ${aposta}`,
          unit_price: parseFloat(valor),
          quantity: 1,
        }
      ],
      payer: {
        phone: {
          number: telefone
        }
      },
      external_reference: JSON.stringify({ aposta, telefone }), // Armazena os dados da aposta
      notification_url: 'https://seusite.com/notificacao', // URL para receber notificações de pagamento
      back_urls: {
        success: 'https://seusite.com/sucesso',
        failure: 'https://seusite.com/erro',
        pending: 'https://seusite.com/pendente'
      },
      auto_return: 'approved'
    };

    const response = await mercadopago.preferences.create(preference);
    
    res.json({
      id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });

  } catch (error) {
    console.error('Erro ao criar pagamento:', error);
    res.status(500).json({ erro: 'Erro ao criar pagamento.' });
  }
});

// Rota para receber notificações de pagamento (webhook)
app.post('/notificacao', async (req, res) => {
  const { id, type } = req.query;

  try {
    if (type === 'payment') {
      const payment = await mercadopago.payment.findById(id);
      const paymentStatus = payment.body.status;
      
      if (paymentStatus === 'approved') {
        const { aposta, telefone } = JSON.parse(payment.body.external_reference);
        
        // Salva no Firebase somente após pagamento aprovado
        const db = admin.firestore();
        await db.collection('apostas').add({ 
          aposta, 
          telefone, 
          paymentId: id,
          status: 'pago',
          timestamp: admin.firestore.FieldValue.serverTimestamp() 
        });
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro ao processar notificação:', error);
    res.status(500).send('Erro ao processar pagamento');
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});