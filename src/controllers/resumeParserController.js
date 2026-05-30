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

Important rules for location fields:
- Do NOT guess city/state from context (example: do not auto-pick a state capital). If it's not clearly present in the resume, use null.
- If state is written in short form (e.g. "U.P", "UP", "TN"), return the full state name.
- Use the city name as written in the resume (expand only obvious abbreviations like BLR -> Bengaluru).

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
  "certifications": string[],
  "subjects_taught": string[],
  "boards_taught": string[],
  "grades_taught": string[],
  "reason_to_join": string[],
  "where_did_you_hear_about_us": string[],
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

function isBlank(val) {
  return val == null || (typeof val === 'string' && val.trim() === '');
}

function normalizeStringOrNull(val) {
  if (val == null) return null;
  if (typeof val !== 'string') return String(val);
  const t = val.trim();
  return t === '' ? null : t;
}

function stripLabel(line) {
  return String(line || '').replace(
    /^\s*(address|current\s*location|preferred\s*location|location|loc)\s*[:\-–—]\s*/i,
    ''
  );
}

const INDIA_STATES_UT = new Set([
  'andhra pradesh',
  'arunachal pradesh',
  'assam',
  'bihar',
  'chhattisgarh',
  'goa',
  'gujarat',
  'haryana',
  'himachal pradesh',
  'jharkhand',
  'karnataka',
  'kerala',
  'madhya pradesh',
  'maharashtra',
  'manipur',
  'meghalaya',
  'mizoram',
  'nagaland',
  'odisha',
  'orissa',
  'punjab',
  'rajasthan',
  'sikkim',
  'tamil nadu',
  'telangana',
  'tripura',
  'uttar pradesh',
  'uttarakhand',
  'west bengal',
  'andaman and nicobar islands',
  'chandigarh',
  'dadra and nagar haveli',
  'daman and diu',
  'delhi',
  'new delhi',
  'jammu and kashmir',
  'ladakh',
  'lakshadweep',
  'puducherry',
  'pondicherry',
]);

const US_STATES = new Set([
  'alabama',
  'alaska',
  'arizona',
  'arkansas',
  'california',
  'colorado',
  'connecticut',
  'delaware',
  'florida',
  'georgia',
  'hawaii',
  'idaho',
  'illinois',
  'indiana',
  'iowa',
  'kansas',
  'kentucky',
  'louisiana',
  'maine',
  'maryland',
  'massachusetts',
  'michigan',
  'minnesota',
  'mississippi',
  'missouri',
  'montana',
  'nebraska',
  'nevada',
  'new hampshire',
  'new jersey',
  'new mexico',
  'new york',
  'north carolina',
  'north dakota',
  'ohio',
  'oklahoma',
  'oregon',
  'pennsylvania',
  'rhode island',
  'south carolina',
  'south dakota',
  'tennessee',
  'texas',
  'utah',
  'vermont',
  'virginia',
  'washington',
  'west virginia',
  'wisconsin',
  'wyoming',
  'district of columbia',
]);

const INDIA_STATE_ABBR = new Map([
  ['AP', 'Andhra Pradesh'],
  ['AR', 'Arunachal Pradesh'],
  ['AS', 'Assam'],
  ['BR', 'Bihar'],
  ['CG', 'Chhattisgarh'],
  ['CT', 'Chhattisgarh'],
  ['GA', 'Goa'],
  ['GJ', 'Gujarat'],
  ['HR', 'Haryana'],
  ['HP', 'Himachal Pradesh'],
  ['JH', 'Jharkhand'],
  ['KA', 'Karnataka'],
  ['KL', 'Kerala'],
  ['MP', 'Madhya Pradesh'],
  ['MH', 'Maharashtra'],
  ['MN', 'Manipur'],
  ['ML', 'Meghalaya'],
  ['MZ', 'Mizoram'],
  ['NL', 'Nagaland'],
  ['OD', 'Odisha'],
  ['OR', 'Odisha'],
  ['PB', 'Punjab'],
  ['RJ', 'Rajasthan'],
  ['SK', 'Sikkim'],
  ['TN', 'Tamil Nadu'],
  ['TS', 'Telangana'],
  ['TR', 'Tripura'],
  ['UP', 'Uttar Pradesh'],
  ['UK', 'Uttarakhand'],
  ['UT', 'Uttarakhand'],
  ['WB', 'West Bengal'],
  // UTs / common
  ['DL', 'Delhi'],
  ['PY', 'Puducherry'],
  ['AN', 'Andaman and Nicobar Islands'],
  ['CH', 'Chandigarh'],
  ['LD', 'Lakshadweep'],
  ['JK', 'Jammu and Kashmir'],
  ['LA', 'Ladakh'],
]);

const US_STATE_ABBR = new Map([
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
  ['DC', 'District of Columbia'],
]);

const CITY_ABBR = new Map([
  ['BLR', 'Bengaluru'],
  ['BNG', 'Bengaluru'],
  ['HYD', 'Hyderabad'],
  ['CHN', 'Chennai'],
  ['DEL', 'Delhi'],
  ['NDL', 'New Delhi'],
  ['MUM', 'Mumbai'],
  ['BOM', 'Mumbai'],
  ['KOL', 'Kolkata'],
  ['CCU', 'Kolkata'],
  ['AMD', 'Ahmedabad'],
  ['AHM', 'Ahmedabad'],
  ['PNQ', 'Pune'],
  ['PUN', 'Pune'],
]);

function titleCase(str) {
  const s = String(str || '').trim();
  if (!s) return s;
  // preserve all-caps acronyms like NCR, USA
  if (/^[A-Z]{2,}$/.test(s)) return s;
  return s
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      const lower = w.toLowerCase();
      // preserve separators within words (e.g. "and", "of" keep lower-case)
      if (lower === 'and' || lower === 'of' || lower === 'the') return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function normalizeState(token) {
  if (token == null) return null;
  const raw = String(token).trim();
  if (!raw) return null;

  const cleanedKey = raw.replace(/[^A-Za-z]/g, '').toUpperCase(); // "U.P" -> "UP"
  if (cleanedKey.length === 2) {
    if (INDIA_STATE_ABBR.has(cleanedKey)) return INDIA_STATE_ABBR.get(cleanedKey);
    if (US_STATE_ABBR.has(cleanedKey)) return US_STATE_ABBR.get(cleanedKey);
  }

  const l = raw.toLowerCase();
  if (l === 'orissa') return 'Odisha';
  if (l === 'pondicherry') return 'Puducherry';
  if (l === 'new delhi') return 'Delhi';

  if (INDIA_STATES_UT.has(l) || US_STATES.has(l)) return titleCase(raw);

  // Handle patterns like "U P" / "U.P."
  if (/^[A-Za-z]\s*\.?\s*[A-Za-z]\s*\.?\s*$/.test(raw) && cleanedKey.length === 2) {
    if (INDIA_STATE_ABBR.has(cleanedKey)) return INDIA_STATE_ABBR.get(cleanedKey);
    if (US_STATE_ABBR.has(cleanedKey)) return US_STATE_ABBR.get(cleanedKey);
  }

  return raw;
}

function normalizeCity(token) {
  if (token == null) return null;
  const raw = String(token).trim();
  if (!raw) return null;

  // Only expand when it's clearly an abbreviation token (no spaces, short, or dotted)
  const abbrevLike = !/\s/.test(raw) && (raw.length <= 5 || /\./.test(raw));
  if (abbrevLike) {
    const key = raw.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (CITY_ABBR.has(key)) return CITY_ABBR.get(key);
  }

  // Common spelling normalization
  const lower = raw.toLowerCase();
  if (lower === 'bangalore' || lower === 'bengaluru') return 'Bengaluru';
  if (lower === 'bombay' || lower === 'mumbai') return 'Mumbai';
  if (lower === 'madras' || lower === 'chennai') return 'Chennai';
  if (lower === 'calcutta' || lower === 'kolkata') return 'Kolkata';

  return titleCase(raw);
}

function looksLikeCountry(token) {
  const t = String(token || '').trim().toLowerCase();
  return (
    t === 'india' ||
    t === 'bharat' ||
    t === 'usa' ||
    t === 'u.s.a' ||
    t === 'us' ||
    t === 'u.s.' ||
    t === 'united states' ||
    t === 'united states of america'
  );
}

function normalizeCountry(token) {
  const t = String(token || '').trim();
  const l = t.toLowerCase();
  if (l === 'bharat') return 'India';
  if (l === 'u.s.a' || l === 'usa' || l === 'us' || l === 'u.s.') return 'United States';
  if (l === 'united states of america') return 'United States';
  if (l === 'india') return 'India';
  return t;
}

function looksLikeState(token) {
  const t = String(token || '').trim();
  if (!t) return false;
  const l = t.toLowerCase();
  if (INDIA_STATES_UT.has(l) || US_STATES.has(l)) return true;
  // 2-letter code like "TN" / "CA"
  if (/^[A-Z]{2}$/.test(t)) return true;
  // dotted/space short form like "U.P" / "U P"
  if (/^[A-Za-z]\s*\.?\s*[A-Za-z]\s*\.?\s*$/.test(t)) return true;
  return false;
}

function cleanupLocationLine(line) {
  return stripLabel(line)
    // remove email / urls / obvious phone labels
    .replace(/\b(mail|email)\b\s*[:\-–—]?\s*\S+/gi, ' ')
    .replace(/\b(ph|phone|mob|mobile)\b\s*[:\-–—]?\s*[\+\d][\d\s\-()]{6,}/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLoose(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function looseIncludes(haystack, needle) {
  const h = normalizeLoose(haystack);
  const n = normalizeLoose(needle);
  if (!h || !n) return false;
  // word-boundary-ish: ensure token sequence exists
  return (` ${h} `).includes(` ${n} `) || h.includes(n);
}

function parseLocationFromLine(line) {
  const cleaned = cleanupLocationLine(line);
  if (!cleaned) return null;

  // Pull out postal/pincode if present (India 6-digit with optional space; US ZIP)
  const pinMatch =
    cleaned.match(/\b(\d{3}\s?\d{3})\b/) || cleaned.match(/\b(\d{5})(?:-\d{4})?\b/);
  const pin = pinMatch ? pinMatch[1].replace(/\s+/g, '') : null;

  // Remove trailing pin-ish segments for tokenization (keep original as address candidate)
  const withoutPin = cleaned.replace(/\b(\d{3}\s?\d{3})\b/g, '').replace(/\b(\d{5})(?:-\d{4})?\b/g, '').trim();

  // Prefer comma-separated tokens
  let parts = withoutPin.split(',').map((p) => p.trim()).filter(Boolean);

  // Fallback: "City - State" or "City – State"
  if (parts.length < 2) {
    parts = withoutPin.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  }

  if (parts.length < 2) return pin ? { pin } : null;

  // If last token is a country, record it and drop it
  let country = null;
  const last = parts[parts.length - 1];
  if (looksLikeCountry(last)) {
    country = normalizeCountry(last);
    parts = parts.slice(0, -1);
  }

  let city = null;
  let state = null;
  let cityAlt = null;
  let districtTagged = false;

  if (parts.length >= 3) {
    // Treat "... , City/District , State" (optionally , Country handled above)
    city = parts[parts.length - 2];
    cityAlt = parts[parts.length - 3];
    state = parts[parts.length - 1];

    // If the "city" token is explicitly tagged as a district, prefer the previous token
    // e.g. "Achhnera, Dist-Agra, U.P"
    const cityEsc = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b(dist|district)\\b[^\\n,]*\\b${cityEsc}\\b|\\b${cityEsc}\\b[^\\n,]*\\b(dist|district)\\b`, 'i').test(cleaned)) {
      districtTagged = true;
    }
  } else {
    // Two tokens — usually "City, State", but sometimes "Area, City"
    const [a, b] = parts;
    if (looksLikeState(b)) {
      city = a;
      state = b;
    } else {
      // Assume second is the city (e.g. "Mylapore, Chennai")
      city = b;
      state = null;
    }
  }

  return {
    city: city ? normalizeCity(city) : null,
    cityAlt: cityAlt ? normalizeCity(cityAlt) : null,
    districtTagged,
    state: state ? normalizeState(state) : null,
    country,
    pin,
    addressCandidate: cleaned,
  };
}

function extractLocationFallback(resumeText) {
  const lines = String(resumeText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 60); // resumes usually have header contact details early

  // First: explicit labels
  for (const line of lines) {
    if (/^\s*(address|current\s*location|location)\b/i.test(line)) {
      const loc = parseLocationFromLine(line);
      if (loc && (loc.city || loc.state || loc.country || loc.pin || loc.addressCandidate)) return loc;
    }
  }

  // Next: any likely "X, Y" line (skip lines with email/links)
  for (const line of lines) {
    if (/@|https?:\/\//i.test(line)) continue;
    if (!/,/.test(line) && !/[-–—]/.test(line)) continue;
    const loc = parseLocationFromLine(line);
    if (loc && (loc.city || loc.state || loc.country || loc.pin)) return loc;
  }

  return null;
}

function applyLocationFallback(parsed, resumeText) {
  const obj = parsed && typeof parsed === 'object' ? parsed : {};

  // Normalize empty strings to null for scalar fields we care about
  obj.city = normalizeStringOrNull(obj.city);
  obj.state = normalizeStringOrNull(obj.state);
  obj.country = normalizeStringOrNull(obj.country);
  obj.address = normalizeStringOrNull(obj.address);
  obj.current_location = normalizeStringOrNull(obj.current_location);

  // Expand abbreviations even when AI filled values (e.g. "U.P")
  if (!isBlank(obj.state)) obj.state = normalizeState(obj.state);
  if (!isBlank(obj.city)) obj.city = normalizeCity(obj.city);

  const cityAppears = !isBlank(obj.city) && looseIncludes(resumeText, obj.city);
  const stateAppears = !isBlank(obj.state) && looseIncludes(resumeText, obj.state);

  // If AI produced a city/state that doesn't exist in the resume text, we should not trust it.
  if (!cityAppears) obj.city = null;
  if (!stateAppears && !isBlank(obj.state)) {
    // keep state if it is an abbreviation match in text (e.g. "U.P" but we normalized to "Uttar Pradesh")
    const stateRaw = normalizeLoose(resumeText);
    const abbr = String(obj.state || '').match(/\b([A-Za-z])\s*\.?\s*([A-Za-z])\b/);
    if (!abbr || !stateRaw.includes(`${abbr[1]} ${abbr[2]}`.toLowerCase())) {
      // don't blank state if it's a known full name but not present due to OCR; only blank when clearly wrong
      // (city is more important to correct, state can remain if normalized from a short code)
    }
  }

  if (!isBlank(obj.city) && !isBlank(obj.state)) return obj;

  const fromFields =
    parseLocationFromLine(obj.address) ||
    parseLocationFromLine(obj.current_location) ||
    extractLocationFallback(resumeText);

  if (!fromFields) return obj;

  if (isBlank(obj.address) && fromFields.addressCandidate) obj.address = fromFields.addressCandidate;
  if (isBlank(obj.city)) {
    // If district is tagged, prefer cityAlt; otherwise city.
    const candidate = fromFields.districtTagged ? (fromFields.cityAlt || fromFields.city) : (fromFields.city || fromFields.cityAlt);
    if (candidate) obj.city = normalizeCity(candidate);
  }
  if (isBlank(obj.state) && fromFields.state) obj.state = normalizeState(fromFields.state);
  if (isBlank(obj.country) && fromFields.country) obj.country = fromFields.country;

  return obj;
}

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
    parsed = applyLocationFallback(parsed, resumeText);
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
