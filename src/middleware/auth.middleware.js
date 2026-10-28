import { getSupabaseClient } from "../config/supabase.js";
import { getPrisma } from "../config/database.js";

function getDisplayName(authUser) {
  const metadata = authUser.user_metadata ?? {};
  const candidate = metadata.full_name || metadata.name || metadata.display_name;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  return authUser.email?.split("@")[0] || "Petani TANIWAVE";
}

async function getOrCreateProfile(authUser) {
  const prisma = getPrisma();
  const email = authUser.email?.toLowerCase();
  if (!email) {
    const error = new Error("Akun Supabase tidak memiliki email. Lengkapi email sebelum memakai TANIWAVE.");
    error.statusCode = 403;
    error.code = "AUTH_EMAIL_REQUIRED";
    throw error;
  }

  if (!authUser.email_confirmed_at) {
    const error = new Error("Verifikasi email Supabase sebelum mengakses data TANIWAVE.");
    error.statusCode = 403;
    error.code = "EMAIL_NOT_VERIFIED";
    throw error;
  }

  let profile = await prisma.user.findUnique({ where: { supabaseId: authUser.id } });
  if (profile) return profile;

  // Supports a pre-existing local profile with the same email without creating duplicates.
  const sameEmail = await prisma.user.findUnique({ where: { email } });
  if (sameEmail) {
    if (sameEmail.supabaseId && sameEmail.supabaseId !== authUser.id) {
      const error = new Error("Email ini sudah terhubung dengan identitas yang berbeda.");
      error.statusCode = 409;
      error.code = "AUTH_PROFILE_CONFLICT";
      throw error;
    }

    return prisma.user.update({
      where: { id: sameEmail.id },
      data: {
        supabaseId: authUser.id,
        avatarUrl: sameEmail.avatarUrl || authUser.user_metadata?.avatar_url || null
      }
    });
  }

  return prisma.user.create({
    data: {
      supabaseId: authUser.id,
      name: getDisplayName(authUser),
      email,
      avatarUrl: authUser.user_metadata?.avatar_url || null,
      role: "FARMER"
    }
  });
}

export async function requireAuth(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    const [scheme, token] = authorization.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      return res.status(401).json({
        success: false,
        error: { code: "AUTH_REQUIRED", message: "Kirim access token Supabase melalui header Authorization: Bearer <token>." }
      });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({
        success: false,
        error: { code: "AUTH_NOT_CONFIGURED", message: "SUPABASE_URL dan SUPABASE_ANON_KEY belum dikonfigurasi di backend." }
      });
    }

    // getUser(token) verifies the token with Supabase Auth; userId is never taken from the request body.
    let authResult;
    try {
      authResult = await supabase.auth.getUser(token);
    } catch {
      return res.status(503).json({
        success: false,
        error: { code: "AUTH_PROVIDER_UNAVAILABLE", message: "Supabase Auth sementara tidak dapat dihubungi." }
      });
    }
    const { data, error } = authResult;
    if (error || !data?.user) {
      return res.status(401).json({
        success: false,
        error: { code: "INVALID_ACCESS_TOKEN", message: "Access token tidak valid atau sudah kedaluwarsa." }
      });
    }

    const profile = await getOrCreateProfile(data.user);
    res.locals.auth = { supabaseUser: data.user, user: profile };
    return next();
  } catch (error) {
    return next(error);
  }
}
