/** Usuarios y permisos del CRM. */

export type Rol = "ejecutivo" | "operaciones" | "jefe_comercial" | "admin";

export const ROLES: Rol[] = ["ejecutivo", "operaciones", "jefe_comercial", "admin"];

export const ETIQUETA_ROL: Record<Rol, string> = {
  ejecutivo: "Ejecutivo comercial",
  operaciones: "Operaciones",
  jefe_comercial: "Jefatura comercial",
  admin: "Administrador",
};

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  /** Hash scrypt de la clave, en hexadecimal. */
  hash: string;
  salt: string;
  creadoEn: string;
  ultimoIngresoEn: string | null;
}

/** Datos del usuario que se pueden mostrar; nunca el hash. */
export type UsuarioPublico = Omit<Usuario, "hash" | "salt">;

export function aPublico(usuario: Usuario): UsuarioPublico {
  const { hash: _hash, salt: _salt, ...publico } = usuario;
  return publico;
}

export type Permiso =
  | "ver_toda_la_cartera"
  | "ver_control_de_gestion"
  | "editar_cierre"
  | "editar_documentos"
  | "gestionar_usuarios"
  | "reasignar_cartera";

const PERMISOS: Record<Rol, Permiso[]> = {
  ejecutivo: ["editar_cierre", "editar_documentos"],
  operaciones: ["ver_toda_la_cartera", "editar_cierre", "editar_documentos"],
  jefe_comercial: [
    "ver_toda_la_cartera",
    "ver_control_de_gestion",
    "editar_cierre",
    "editar_documentos",
    "reasignar_cartera",
  ],
  admin: [
    "ver_toda_la_cartera",
    "ver_control_de_gestion",
    "editar_cierre",
    "editar_documentos",
    "gestionar_usuarios",
    "reasignar_cartera",
  ],
};

export function puede(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS[rol].includes(permiso);
}
