const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');
const pool = require('../config/database');

function parseMaybeJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
    try {
      return JSON.parse(val.toString('utf8'));
    } catch {
      return null;
    }
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (t === '') return null;
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return val;
}

async function getOpenAIKey() {
  const [rows] = await pool.execute(
    'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
    ['openai_api_key']
  );
  if (!rows.length) return '';
  const parsed = parseMaybeJson(rows[0].value);
  const key = parsed != null ? String(parsed).trim() : '';
  return key.replace(/^['"]|['"]$/g, '');
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
          'Update openai_api_key in settings with a new key from https://platform.openai.com/api-keys, then retry.',
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
let _openaiKey = null;
function getOpenAI(apiKey) {
  if (!_openai || _openaiKey !== apiKey) {
    _openaiKey = apiKey;
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

const SYSTEM_PROMPT = `You are a resume parser. Extract structured data from the resume text and return ONLY a valid JSON object — no markdown, no explanation.

Use this exact schema (use null for missing scalar fields, empty arrays [] for missing arrays):

{
  "name": string,
  "mobile": string,
  "email": string,
  "country": string,
  "state": string,
  "city": string,
  "address": string,
  "ug_college": string,
  "pg_university": string,
  "qualification": string,
  "certifications": string,
  "subject_taught": string,
  "boards_taught": string[],
  "grades_taught": string[],
  "reason_to_join": string,
  "where_did_you_hear_about_us": string,
  "current_location": string,
  "preferred_location": string,
  "area_of_interest": string,
  "employed": boolean,
  "salary": number | null,
  "work_history": [
    {
      "school_organization": string,
      "role": string,
      "duration_from": "YYYY-MM-DD" | null,
      "duration_to": "YYYY-MM-DD" | null
    }
  ],
  "total_years_experience": number | null,
  "notes": string
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

  let apiKey = '';
  try {
    apiKey = await getOpenAIKey();
  } catch (err) {
    // DB unavailable — fall back to env
    apiKey = process.env.OPENAI_API_KEY || '';
  }

  if (!apiKey) {
    return res.status(503).json({
      error: 'Resume AI parsing is not configured',
      detail: 'Set OPENAI_API_KEY in .env or openai_api_key in settings.',
    });
  }

  let parsed;
  try {
    const openai = getOpenAI(apiKey);
    const completion = await openai.chat.completions.create({
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
