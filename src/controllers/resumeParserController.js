const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');

function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY
    ? String(process.env.OPENAI_API_KEY).trim().replace(/^['"]|['"]$/g, '')
    : '';
  return key;
}

function openAiClientError(err) {
  const msg = err?.message ? String(err.message) : 'Unknown error';
  const status = err?.status ?? err?.response?.status;

  if (
    status === 401 ||
    /incorrect api key|invalid api key|authentication/i.test(msg)
  ) {
    return {
      status: 503,
      body: {
        error: 'OpenAI API key is invalid or expired',
        detail:
          'Update OPENAI_API_KEY in your .env file with a new key from https://platform.openai.com/api-keys, then restart the server (npm run dev).',
      },
    };
  }

  if (/quota|billing|insufficient/i.test(msg)) {
    return {
      status: 503,
      body: {
        error: 'OpenAI account has no quota or billing issue',
        detail: 'Check billing at https://platform.openai.com/account/billing',
      },
    };
  }

  return {
    status: 502,
    body: {
      error: 'AI parsing failed',
      detail: msg,
    },
  };
}

let _openai;
function getOpenAI() {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing in .env');
  }
  if (!_openai) _openai = new OpenAI({ apiKey });
  return _openai;
}

const SYSTEM_PROMPT = `You are a resume parser. Extract structured data from the resume text and return ONLY a valid JSON object — no markdown, no explanation.

Use this exact schema (omit fields you cannot find, use null for missing scalar fields, empty arrays [] for missing arrays):

{
  "name": string,
  "mobile": string,
  "email": string,
  "state": string,
  "city": string,
  "address": string,
  "ugCollege": string,
  "pgUniversity": string,
  "qualification": string,
  "certifications": string,
  "subject": string,
  "boards": string[],
  "grades": string[],
  "roles": string[],
  "currentLocation": string,
  "preferredLocation": string,
  "areaOfInterest": string,
  "currentSalary": number | null,
  "experienceYears": number | null,
  "status": "active",
  "skills": string[],
  "notes": string,
  "workHistory": [
    {
      "id": "work-temp-<N>",
      "schoolName": string,
      "role": string,
      "from": "YYYY-MM-DD" | null,
      "to": "YYYY-MM-DD" | null,
      "currentlyWorking": boolean
    }
  ]
}`;

function resolveType(mimetype, originalname) {
  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimetype === 'application/msword' ||
    /\.docx?$/i.test(originalname || '')
  ) return 'docx';

  if (
    mimetype === 'application/pdf' ||
    /\.pdf$/i.test(originalname || '')
  ) return 'pdf';

  return null;
}

async function extractText(buffer, mimetype, originalname) {
  const type = resolveType(mimetype, originalname);

  if (type === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (type === 'pdf') {
    const result = await pdfParse(buffer);
    return result.text;
  }

  throw new Error(`Unsupported file type: ${mimetype}`);
}

async function parseResume(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Send a resume as multipart/form-data field "resume".' });
  }

  const { buffer, mimetype, originalname } = req.file;

  let resumeText;
  try {
    resumeText = await extractText(buffer, mimetype, originalname);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  if (!resumeText || resumeText.trim().length < 20) {
    return res.status(422).json({ error: 'Could not extract readable text from the file.' });
  }

  if (!getOpenAIKey()) {
    return res.status(503).json({
      error: 'Resume AI parsing is not configured',
      detail:
        'Add OPENAI_API_KEY to .env (see .env.example), then restart the server.',
    });
  }

  let parsed;
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: resumeText },
      ],
      response_format: { type: 'json_object' },
    });

    parsed = JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    console.error('OpenAI error:', err);
    const mapped = openAiClientError(err);
    return res.status(mapped.status).json(mapped.body);
  }

  return res.json({
    ...parsed,
    resumeFileName: originalname || null,
    resumeMime: mimetype || null,
  });
}

module.exports = { parseResume };
