function getOptionalEnv(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return "";
}

function getSupabaseConfig() {
  return {
    url: getOptionalEnv("SUPABASE_URL", "VITE_SUPABASE_URL") || "https://bnpxshdnckyubwgkwmpx.supabase.co",
    anonKey:
      getOptionalEnv("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY") ||
      "sb_publishable_b9uy6XuIZHKou9z89suVLA_EkOgnGtO",
  };
}

function getBearerToken(req) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function requireAuthenticatedUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error("Login required");
    error.statusCode = 401;
    throw error;
  }

  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = new Error("Login required");
    error.statusCode = 401;
    throw error;
  }

  return response.json();
}

module.exports = {
  requireAuthenticatedUser,
};
