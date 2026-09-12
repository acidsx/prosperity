/**
 * Alta de usuarios.
 *
 * No hay auto-registro: los usuarios los crea un administrador. El primer
 * usuario se siembra con `npm run sembrar-usuarios`.
 */

import "server-only";

import { hashDeClave, problemaDeClave } from "@/lib/auth/clave";
import type { Rol, Usuario } from "@/lib/auth/tipos";
import { tienda } from "@/lib/datos";
import { nuevoId } from "@/lib/datos/tienda";

export async function crearUsuario(datos: {
  nombre: string;
  email: string;
  rol: Rol;
  clave: string;
}): Promise<Usuario> {
  const problema = problemaDeClave(datos.clave);
  if (problema) throw new Error(problema);

  const email = datos.email.trim().toLowerCase();
  const existente = await tienda().usuarioPorEmail(email);
  if (existente) throw new Error(`Ya existe un usuario con el correo ${email}`);

  const { hash, salt } = await hashDeClave(datos.clave);
  const usuario: Usuario = {
    id: nuevoId("usr"),
    nombre: datos.nombre.trim(),
    email,
    rol: datos.rol,
    activo: true,
    hash,
    salt,
    creadoEn: new Date().toISOString(),
    ultimoIngresoEn: null,
  };

  await tienda().guardarUsuario(usuario);
  return usuario;
}

export async function cambiarClave(usuarioId: string, clave: string): Promise<void> {
  const problema = problemaDeClave(clave);
  if (problema) throw new Error(problema);

  const usuario = await tienda().obtenerUsuario(usuarioId);
  if (!usuario) throw new Error("Usuario no encontrado");

  const { hash, salt } = await hashDeClave(clave);
  await tienda().guardarUsuario({ ...usuario, hash, salt });
}
