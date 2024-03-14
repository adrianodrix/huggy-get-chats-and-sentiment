require('dotenv').config();
const OpenAI = require("openai");
const axios = require('axios');
const axiosRetry = require('axios-retry');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const pages = 1048;

// Configura o Axios para tentar novamente solicitações falhas
axiosRetry(axios, { retries: 3 });

// Configura Open.ai
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Configuração do Axios para a API da Huggy
const huggyAxios = axios.create({
  baseURL: 'https://api.huggy.io/v2/',
  headers: {
    'X-Authorization': `Bearer ${process.env.HUGGY_API_KEY}`
  }
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}  

async function writeToCsv(rows) {
    const csvWriter = createCsvWriter({
      path: 'chats_analysis.csv',
      header: [
        {id: 'chatId', title: 'ID do Chat'},
        {id: 'createdAt', title: 'Criado em'},
        {id: 'attendedAt', title: 'Atendido em'},
        {id: 'closedAt', title: 'Finalizado em'},
        {id: 'clientId', title: 'ID do Cliente'},
        {id: 'clientName', title: 'Nome do Cliente'},
        {id: 'email', title: 'Email'},
        {id: 'phoneNumber', title: 'Telefone'},
        {id: 'cnpj', title: 'CNPJ'},
        {id: 'certificateType', title: 'Certificado Digital'},
        {id: 'issuer', title: 'Emissor'},
        {id: 'agent', title: 'Atendente'},
        {id: 'keywords', title: 'Palavras-Chave'},
        {id: 'resolved', title: 'Resolvido (Sim/Não)'},
        {id: 'sentiment', title: 'Sentimento (Positivo/Negativo/Neutro)'},
        {id: 'analysis', title: 'Análise'}
      ]
    });
  
    await csvWriter.writeRecords(rows);
  }
  

async function fetchChats() {
    let allChats = [];
    let page = 0;
    let hasMore = true;
  
    while (hasMore && page <= (pages - 1)) {
      const response = await huggyAxios.get(`chats?page=${page}`);
      if (response.data.length > 0) {
        allChats = allChats.concat(response.data);
        page++;
      } else {
        hasMore = false;
      }
      await sleep(3000); // Aguarda 3 segundos antes da próxima requisição
    }
  
    return allChats;
  }
  

  async function fetchMessages(chatId) {
    let allMessages = [];
    let page = 0;
    let hasMore = true;
  
    while (hasMore && page <= (pages - 1)) {
      const response = await huggyAxios.get(`chats/${chatId}/messages?page=${page}`);
      if (response.data.length > 0) {
        allMessages = allMessages.concat(response.data);
        page++;
      } else {
        hasMore = false;
      }
      await sleep(2000); // Aguarda 2 segundos antes da próxima requisição
    }
  
    return allMessages;
  }
  

  async function analyzeChat(messages) {
    // Ordena as mensagens por data de envio
    const sortedMessages = messages.sort((a, b) => new Date(a.send_at) - new Date(b.send_at));

    // Filtra mensagens com body preenchido e formata o texto
    const chatText = sortedMessages
    .filter(msg => (msg.body || msg.senderType !== 'virtual_agent'))
    .map(msg => {
        let senderLabel = 'atendente'; // Valor padrão
        if (msg.sender.id === msg.customer.id) {
            senderLabel = 'cliente';
        } else if (msg.senderType === 'virtual_agent') {
            senderLabel = 'bot';
        }

        return `enviado por: ${senderLabel}\nmensagem: ${msg.body}`;
    })
    .join('\n');
    
    try {
      const chatCompletion = await openai.chat.completions.create({
        model:"gpt-3.5-turbo-0125",
        response_format: { "type": "json_object" },
        messages: [
          { role: 'system', content: `
          Você será encarregado de analisar um texto representando uma conversa de live chat de suporte técnico. 
          Sua missão consiste em duas partes principais:
          
          Classificar o Sentimento da Conversa: 
          Avalie o diálogo e determine o sentimento geral expresso pelo cliente em relação ao atendimento recebido. 
          As opções de classificação são:
          Positivo: O cliente demonstra satisfação ou felicidade com o serviço.
          Neutro: O cliente expressa um tom indiferente, sem inclinação clara para satisfação ou insatisfação.
          Negativo: O cliente mostra insatisfação, frustração ou qualquer forma de desagrado.

          Determinar a Resolução do Problema: 
          Identifique se o cliente considerou o problema como resolvido ao final do atendimento. 
          As opções de resposta são:
          Sim: O problema foi claramente resolvido durante a conversa.
          Não: O problema permanece sem solução apesar do atendimento.
          Indefinido: Não há informação suficiente para determinar se o problema foi resolvido.
          
          Diretrizes para a Análise:
          Baseie sua classificação do sentimento nas expressões verbais do cliente, levando em conta palavras-chave, tom e contexto. Ignore as mensagens de bot.
          Para determinar a resolução do problema, considere as últimas interações do chat e qualquer confirmação explícita de resolução ou persistência do problema.
          Na sua explicação para a classificação do sentimento, forneça exemplos específicos da conversa que justifiquem sua decisão.
          
          Formato de Entrega:
          Forneça suas conclusões em um objeto JSON estruturado da seguinte forma:
          {
            "resolved": "sim/nao/indefinido",
            "sentiment": "positivo/neutro/negativo",
            "analysis": "Sua explicação aqui, citando exemplos específicos da conversa para justificar a classificação do sentimento."
            "keywords": "Uma lista de palavras-chave importantes que traduzem o erro enfrentado pelo cliente, ignore palavras-chaves codiginas como: olá, bom dia, treeunfe"
          }
          Por favor, assegure-se de substituir os campos "sim/nao/indefinido" e "positivo/neutro/negativo" pela sua avaliação, e preencha o campo "motivo" 
          com uma explicação concisa, mas informativa, limitado a 240 caracteres.
          ` },
          { role: 'user', content: chatText }
        ],
      });
  
      // Extrai e processa a resposta conforme necessário
      const analysis = chatCompletion.choices[0].message.content; // Ajuste conforme a estrutura exata da resposta
      
      return analysis;
    } catch (error) {
      console.error('Erro ao analisar chat:', error);
      throw error; // Propagar o erro ou lidar com ele de maneira adequada
    }
  }
  

  async function main() {
    let analysisResults = [];

    try {
        const chats = await fetchChats();
  
        for (const chat of chats) {
          await sleep(3000); // Aguarda 3 segundos antes da próxima requisição
          const messages = await fetchMessages(chat.id);
          
          // Continue apenas se houver mensagens
          if (!messages.length) continue;
          
          // Assumindo que a primeira mensagem tenha as informações do cliente necessárias
          let customer = null;
          let customFields = {};
    
          let agent = "Não identificado"; // Valor padrão caso nenhum atendente seja identificado
    
          for (const message of messages) {
            if (message.customer) {
                customer = message.customer;
                customFields = message.customer.custom_fields || {};
            }
            
            if (message.sender && message.sender.id !== message.customer?.id && !message.sender.name.includes("Treeunfe")) {
                agent = message.sender.name; // Nome do atendente humano
                break; // Sai do loop após identificar o atendente
            }
           }
    
    
          let openai_anlysis = await analyzeChat(messages);
          if (typeof openai_anlysis == 'string') {
            try {
                openai_anlysis = JSON.parse(openai_anlysis);
            } catch ( err) {
                console.error(err);
                continue; // se nao posso avaliar, nao vale a pena registrar.
            }
          }

          const { resolved, sentiment, keywords, analysis } = openai_anlysis;
          const row = {
            chatId: chat.id,
            createdAt: chat.createdAt,
            attendedAt: chat.attendedAt, 
            closedAt: chat.closedAt,
            clientId: customer ? customer.id : '',
            clientName: customer ? customer.name : '',
            email: customer ? customer.email : '',
            phoneNumber: customer ? customer.mobile || customer.phone : '',
            cnpj: customFields ? customFields.cnpj_customer || '' : '',
            certificateType: customFields ? customFields.certificado_customer || '' : '',
            issuer:  customFields ? customFields.emissor_customer || '' : '',
            agent,
            keywords: typeof keywords == 'array' ? keywords.join(', ') : keywords,
            resolved,
            sentiment,
            analysis
          };
      
          analysisResults.push(row);
        }
    } catch (err) {
        console.error(err);
    } finally {
        await writeToCsv(analysisResults);
        console.log('Análise completada e arquivo CSV gerado.');
    }
  }
  
  main().catch(console.error);
  
