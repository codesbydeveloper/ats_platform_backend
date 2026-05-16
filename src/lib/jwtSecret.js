function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || String(secret).trim() === '') {
    return null;
  }
  return secret;
}

module.exports = { getJwtSecret };
