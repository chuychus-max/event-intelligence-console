import { NextResponse, type NextRequest } from "next/server";

// Acceso a la consola. Si CONSOLE_PASSWORD está definida, todo (páginas y API)
// pide usuario y contraseña (Basic Auth; el usuario puede ser cualquiera),
// excepto /api/ingest, que se autentica con su propia x-api-key.
export function proxy(req: NextRequest) {
  const pass = process.env.CONSOLE_PASSWORD;
  if (!pass || req.nextUrl.pathname.startsWith("/api/ingest")) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (given === pass) return NextResponse.next();
    } catch {
      // cabecera mal formada: se pide de nuevo
    }
  }
  return new NextResponse("Acceso restringido", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Event Intelligence", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|estadio.webp).*)"],
};
