"""
Arma el PDF con las conversaciones del closer.

    npm run mockup-datos y npm run auditoria primero, después:
    python3 scripts/pdf-cadena.py [version] [salida.pdf]

La fuente son las mismas grabaciones que corren en las pruebas, así que el
PDF no se escribe aparte: se genera de lo que el sistema produjo.
"""

import json
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

RAIZ = Path(__file__).resolve().parent.parent
VERSION = sys.argv[1] if len(sys.argv) > 1 else "v26"
SALIDA = Path(sys.argv[2]) if len(sys.argv) > 2 else RAIZ / "mockup" / f"cadena-closer-{VERSION}.pdf"

TINTA = colors.HexColor("#141d26")
SUAVE = colors.HexColor("#5d6b7a")
BORDE = colors.HexColor("#dfe4e8")
ACENTO = colors.HexColor("#0e6a54")
ACENTO_BG = colors.HexColor("#e3f0ec")
PROSPECTO_BG = colors.HexColor("#eef1f4")
ALERTA = colors.HexColor("#9e3b26")
ALERTA_BG = colors.HexColor("#f8e8e4")

NOMBRES = {
    "A": ("Perfil A · Primera compra", "Sofía Reyes", "Entra por redes sociales, informal"),
    "B": ("Perfil B · Inversor", "Rodrigo Salazar", "Entra por correo, formal"),
    "C": ("Perfil C · Cliente problemático", "Patricio Vergara", "Entra hostil, prohibiendo el gancho de escasez"),
}


def sin_emoji(texto: str) -> str:
    """Las fuentes base de reportlab no tienen glifos de emoji: salen cajas negras."""
    return re.sub(r"[\U0001F000-\U0001FAFF☀-➿️←-⇿⬀-⯿]", "", texto).strip()


def escapar(texto: str) -> str:
    return sin_emoji(texto).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


base = getSampleStyleSheet()
E = {
    "titulo": ParagraphStyle("titulo", parent=base["Title"], fontName="Helvetica-Bold",
                             fontSize=24, leading=27, textColor=TINTA, alignment=TA_LEFT,
                             spaceAfter=4),
    "sub": ParagraphStyle("sub", parent=base["Normal"], fontName="Helvetica", fontSize=10.5,
                          leading=15, textColor=SUAVE, spaceAfter=14),
    "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=14,
                         leading=17, textColor=TINTA, spaceBefore=6, spaceAfter=2),
    "eyebrow": ParagraphStyle("eyebrow", parent=base["Normal"], fontName="Courier", fontSize=7.5,
                              leading=10, textColor=SUAVE, spaceAfter=2),
    "meta": ParagraphStyle("meta", parent=base["Normal"], fontName="Courier", fontSize=7,
                           leading=9.5, textColor=SUAVE, spaceAfter=2),
    "burbuja": ParagraphStyle("burbuja", parent=base["Normal"], fontName="Helvetica", fontSize=9.5,
                              leading=13.5, textColor=TINTA),
    "nota": ParagraphStyle("nota", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=8,
                           leading=11, textColor=SUAVE, spaceBefore=2, spaceAfter=6),
    "obs": ParagraphStyle("obs", parent=base["Normal"], fontName="Helvetica", fontSize=8,
                          leading=11, textColor=ALERTA),
    "cuerpo": ParagraphStyle("cuerpo", parent=base["Normal"], fontName="Helvetica", fontSize=9.5,
                             leading=14, textColor=TINTA, spaceAfter=7),
}

ANCHO = A4[0] - 40 * mm


def burbuja(turno: dict) -> Table:
    """Un mensaje. El del agente va indentado y en verde, como en un chat."""
    agente = turno["voz"] == "agente"
    problemas = turno.get("problemas") or []
    fondo = ALERTA_BG if problemas else (ACENTO_BG if agente else PROSPECTO_BG)

    quien = "AGENTE" if agente else "PROSPECTO"
    sello = f"{quien}   día {turno['dia']}"
    if turno.get("canal"):
        sello += f" - {turno['canal']}"
    if agente and turno.get("perfil"):
        sello += f" - perfil {turno['perfil']}"

    dentro = [
        [Paragraph(sello, E["meta"])],
        [Paragraph(escapar(turno["texto"]).replace("\n", "<br/>"), E["burbuja"])],
    ]
    for problema in problemas:
        linea = f"[!] {escapar(problema['detalle'])}"
        if problema.get("norma"):
            linea += f"<br/>Norma: {escapar(problema['norma'])}"
        dentro.append([Paragraph(linea, E["obs"])])

    caja = Table(dentro, colWidths=[ANCHO * (0.72 if agente else 0.78)])
    caja.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fondo),
        ("BOX", (0, 0), (-1, -1), 0.5, ALERTA if problemas else BORDE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))

    # Indentar al agente: se envuelve en una tabla de dos columnas.
    if agente:
        fila = Table([["", caja]], colWidths=[ANCHO * 0.28, ANCHO * 0.72])
    else:
        fila = Table([[caja, ""]], colWidths=[ANCHO * 0.78, ANCHO * 0.22])
    fila.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return fila


def tarjeta_resumen(resumen: dict) -> Table:
    obs = len(resumen.get("incumplimientos") or [])
    filas = [
        ["Perfil detectado", f"{resumen['perfilFinal']} · {resumen['etiquetaPerfil']}"],
        ["Detectado en el turno", str(resumen.get("turnoEnQueDetectoElPerfil") or "no lo detectó")],
        ["Presupuesto extraído", f"UF {resumen['presupuestoUf']:,}".replace(",", ".") if resumen.get("presupuestoUf") else "no extraído"],
        ["Plazo de compra", resumen.get("plazoCompra") or "no extraído"],
        ["Método de financiamiento", resumen.get("metodoFinanciamiento") or "no extraído"],
        ["Cierre propuesto", resumen.get("cierrePropuesto") or "ninguno"],
        ["¿Agendó?", "sí" if resumen.get("agendo") else "no"],
        ["Mensajes del agente", str(resumen.get("mensajesDelAgente", 0))],
        ["Observaciones de la verificación", "ninguna" if obs == 0 else str(obs)],
    ]
    tabla = Table(
        [[Paragraph(escapar(k), E["meta"]), Paragraph(escapar(str(v)), E["cuerpo"])] for k, v in filas],
        colWidths=[ANCHO * 0.34, ANCHO * 0.66],
    )
    tabla.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, BORDE),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return tabla


def pie(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(SUAVE)
    canvas.drawString(20 * mm, 12 * mm, f"Prosperity · Cadena del closer {VERSION}")
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"{doc.page}")
    canvas.setStrokeColor(BORDE)
    canvas.setLineWidth(0.4)
    canvas.line(20 * mm, 16 * mm, A4[0] - 20 * mm, 16 * mm)
    canvas.restoreState()


def main():
    datos = json.loads((RAIZ / "mockup" / "v26.min.json").read_text())

    doc = BaseDocTemplate(
        str(SALIDA), pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=22 * mm,
        title=f"Cadena del closer {VERSION}", author="Prosperity",
        subject="Conversaciones del agente closer",
    )
    marco = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="cuerpo")
    doc.addPageTemplates([PageTemplate(id="normal", frames=[marco], onPage=pie)])

    historia = []
    historia.append(Paragraph("PROSPERITY - GESTOR INMOBILIARIO", E["eyebrow"]))
    historia.append(Paragraph(f"Cadena del closer {VERSION}", E["titulo"]))
    historia.append(Paragraph(
        "Las tres conversaciones completas del agente con el prompt "
        f"{VERSION}, corridas con el prompt literal y sin corregir la salida del modelo. "
        "Los mensajes del prospecto están escritos; los del agente los produjo el prompt. "
        "Donde la verificación observó algo, va marcado en rojo bajo el mensaje.",
        E["sub"]))

    # Resumen comparativo de las tres.
    cab = [["", "OBSERVACIONES", "MENSAJES", "¿AGENDÓ?"]]
    for clave in ("A", "B", "C"):
        corrida = datos[clave].get(VERSION)
        if not corrida:
            continue
        r = corrida["resumen"]
        cab.append([
            NOMBRES[clave][0].split(" · ")[1],
            "ninguna" if not r["incumplimientos"] else str(len(r["incumplimientos"])),
            str(r["mensajesDelAgente"]),
            "sí" if r["agendo"] else "no",
        ])
    tabla = Table(cab, colWidths=[ANCHO * 0.4, ANCHO * 0.24, ANCHO * 0.18, ANCHO * 0.18])
    tabla.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Courier"),
        ("FONTSIZE", (0, 0), (-1, 0), 7.5),
        ("TEXTCOLOR", (0, 0), (-1, 0), SUAVE),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, 1), (-1, -1), TINTA),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, BORDE),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    historia.append(tabla)
    historia.append(Spacer(1, 22))

    historia.append(Paragraph("CÓMO LEER ESTE DOCUMENTO", E["eyebrow"]))
    historia.append(Spacer(1, 6))
    leyenda = [
        ("Bloque gris", "Mensaje del prospecto. Es guion: lo escribimos nosotros."),
        ("Bloque verde", "Mensaje del agente. Lo produjo el prompt, sin corregir."),
        ("Bloque rojo", "El agente escribió algo que la verificación observó. La observación va "
                        "debajo del mensaje con la norma que la respalda, cuando corresponde."),
        ("Línea en cursiva", "Nota sobre qué se está poniendo a prueba en ese turno."),
    ]
    tabla_leyenda = Table(
        [[Paragraph(escapar(k), E["meta"]), Paragraph(escapar(v), E["cuerpo"])] for k, v in leyenda],
        colWidths=[ANCHO * 0.24, ANCHO * 0.76],
    )
    tabla_leyenda.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, BORDE),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    historia.append(tabla_leyenda)
    historia.append(Spacer(1, 18))
    historia.append(Paragraph(
        "Las respuestas del modelo provienen de una grabación: el entorno donde se generó este "
        "documento no tiene credencial de API. El prompt, el inventario y la verificación son los "
        "reales y corren en cada prueba del proyecto. Reproducible con "
        "npm run closer -- A --v26 --crudo.",
        E["nota"]))

    for clave in ("A", "B", "C"):
        corrida = datos[clave].get(VERSION)
        if not corrida:
            continue
        titulo, nombre, apertura = NOMBRES[clave]
        historia.append(PageBreak())
        historia.append(Paragraph(titulo.upper(), E["eyebrow"]))
        historia.append(Paragraph(nombre, E["h2"]))
        historia.append(Paragraph(apertura, E["sub"]))
        historia.append(tarjeta_resumen(corrida["resumen"]))
        historia.append(Spacer(1, 12))
        historia.append(Paragraph("LA CONVERSACIÓN", E["eyebrow"]))
        historia.append(Spacer(1, 4))

        for turno in corrida["turnos"]:
            bloque = [burbuja(turno)]
            if turno.get("nota"):
                bloque.append(Paragraph(escapar(turno["nota"]), E["nota"]))
            else:
                bloque.append(Spacer(1, 7))
            historia.append(KeepTogether(bloque))

    doc.build(historia)
    print(f"escrito: {SALIDA}")


if __name__ == "__main__":
    main()
