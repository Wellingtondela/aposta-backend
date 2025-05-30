const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig'); // importa o admin inicializado direto

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Rota de teste
app.get('/', (req, res) => {
  res.send('Servidor de apostas rodando!');
});

// Endpoint para receber a aposta
app.post('/apostar', async (req, res) => {
  const { aposta, telefone } = req.body;

  if (!aposta || !telefone) {
    return res.status(400).json({ erro: 'Aposta e telefone são obrigatórios.' });
  }

  try {
    const db = admin.firestore();
    await db.collection('apostas').add({ 
      aposta, 
      telefone, 
      timestamp: admin.firestore.FieldValue.serverTimestamp() 
    });
    res.json({ sucesso: true, mensagem: 'Aposta salva com sucesso!' });
  } catch (error) {
    console.error('Erro ao salvar aposta:', error);
    res.status(500).json({ erro: 'Erro ao salvar aposta.' });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

