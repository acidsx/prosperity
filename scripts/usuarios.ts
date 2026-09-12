/**
 * Alta de usuarios desde la línea de comandos.
 *
 *   npm run usuarios -- crear "Paula Riveros" paula@corredora.cl ejecutivo
 *   npm run usuarios -- clave paula@corredora.cl
 *   npm run usuarios -- listar
 *
 * Requiere Supabase configurado: con la tienda en memoria los usuarios
 * viven en el proceso de la aplicación y este script no los vería.
 */

import { randomBytes } from "node:crypto";

import { cambiarClave, crearUsuario } from "../src/lib/auth/sembrar";
import { ROLES, type Rol } from "../src/lib/auth/tipos";
import { tienda } from "../src/lib/datos";

function claveAleatoria(): string {
  // Legible al dictarla por teléfono y suficientemente larga.
  return `${randomBytes(6).toString("base64url")}${Math.floor(Math.random() * 90 + 10)}`;
}

async function principal() {
  const db = tienda();
  if (db.nombre !== "supabase") {
    console.error(
      "Este script necesita Supabase configurado (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).\n" +
        "Sin persistencia, los usuarios de demostración se crean solos al abrir la aplicación.",
    );
    process.exit(1);
  }

  const [comando, ...resto] = process.argv.slice(2);

  if (comando === "listar") {
    const usuarios = await db.listarUsuarios();
    for (const usuario of usuarios) {
      console.log(`${usuario.email}\t${usuario.rol}\t${usuario.activo ? "activo" : "inactivo"}\t${usuario.nombre}`);
    }
    return;
  }

  if (comando === "crear") {
    const [nombre, email, rol] = resto;
    if (!nombre || !email || !rol) {
      console.error('Uso: npm run usuarios -- crear "Nombre Apellido" correo@dominio rol');
      console.error(`Roles: ${ROLES.join(", ")}`);
      process.exit(1);
    }
    if (!ROLES.includes(rol as Rol)) {
      console.error(`Rol inválido. Roles: ${ROLES.join(", ")}`);
      process.exit(1);
    }
    const clave = claveAleatoria();
    const usuario = await crearUsuario({ nombre, email, rol: rol as Rol, clave });
    console.log(`Usuario creado: ${usuario.email} (${usuario.rol})`);
    console.log(`Clave inicial: ${clave}`);
    console.log("Entrégasela por un canal seguro y pídele que la cambie.");
    return;
  }

  if (comando === "clave") {
    const [email] = resto;
    if (!email) {
      console.error("Uso: npm run usuarios -- clave correo@dominio");
      process.exit(1);
    }
    const usuario = await db.usuarioPorEmail(email);
    if (!usuario) {
      console.error(`No existe el usuario ${email}`);
      process.exit(1);
    }
    const clave = claveAleatoria();
    await cambiarClave(usuario.id, clave);
    console.log(`Clave nueva de ${email}: ${clave}`);
    return;
  }

  console.error("Comandos: crear | clave | listar");
  process.exit(1);
}

principal().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
