// js/herramientas-respaldo.js
// Lista base de herramientas de respaldo (plan B cuando Firestore no responde).
// Compartida entre el panel admin (/administracion/index.html) y el
// formulario de estudiante (js/inventario.js) para que no se desincronicen.
// No incluye "imagen": cada archivo que la use arma su propia ruta relativa
// según dónde vive (ver comentarios en cada consumidor).
export const HERRAMIENTAS_RESPALDO = [
  { codigo: "HER-001", nombre: "Aceitera",               icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-002", nombre: "Alicate",                icono: "🛠️", cantidadDisponible: 5  },
  { codigo: "HER-003", nombre: "Alicate de presión",     icono: "🛠️", cantidadDisponible: 5  },
  { codigo: "HER-004", nombre: "Broca",                  icono: "🔩",  cantidadDisponible: 10 },
  { codigo: "HER-005", nombre: "Brocha",                 icono: "🖌️", cantidadDisponible: 10 },
  { codigo: "HER-006", nombre: "Cepillo de alambre",     icono: "🪥",  cantidadDisponible: 5  },
  { codigo: "HER-007", nombre: "Cinta adhesiva",         icono: "🎞️", cantidadDisponible: 10 },
  { codigo: "HER-008", nombre: "Cinta métrica",          icono: "📏",  cantidadDisponible: 5  },
  { codigo: "HER-009", nombre: "Cuchilla",                icono: "🔪",  cantidadDisponible: 5  },
  { codigo: "HER-010", nombre: "Destornillador plano",   icono: "🪛",  cantidadDisponible: 8  },
  { codigo: "HER-011", nombre: "Destornillador estrella",icono: "🪛",  cantidadDisponible: 8  },
  { codigo: "HER-012", nombre: "Electrodo",               icono: "⚡",  cantidadDisponible: 20 },
  { codigo: "HER-013", nombre: "Escuadra falsa",          icono: "📐",  cantidadDisponible: 5  },
  { codigo: "HER-014", nombre: "Gira tuerca",             icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-015", nombre: "Granetero",               icono: "🔨",  cantidadDisponible: 5  },
  { codigo: "HER-016", nombre: "Guantes",                 icono: "🧤",  cantidadDisponible: 10 },
  { codigo: "HER-017", nombre: "Lente",                   icono: "🥽",  cantidadDisponible: 10 },
  { codigo: "HER-018", nombre: "Lima cuadrada",           icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-019", nombre: "Lima triangular",         icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-020", nombre: "Lima media caña",         icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-021", nombre: "Lima redonda",            icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-022", nombre: "Llave ajustable",         icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-023", nombre: "Llave allen",             icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-024", nombre: "Llave de mandril",        icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-025", nombre: "Llave de tomo",           icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-026", nombre: "Llave de tuercas",        icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-027", nombre: "Máscara de soldar",       icono: "🥽",  cantidadDisponible: 5  },
  { codigo: "HER-028", nombre: "Marcador numérico",       icono: "🔢",  cantidadDisponible: 5  },
  { codigo: "HER-029", nombre: "Martillo",                icono: "🔨",  cantidadDisponible: 8  },
  { codigo: "HER-030", nombre: "Mazo de goma",            icono: "🔨",  cantidadDisponible: 5  },
  { codigo: "HER-031", nombre: "Macho de 1/2",            icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-032", nombre: "Nivel magnético",         icono: "📐",  cantidadDisponible: 5  },
  { codigo: "HER-033", nombre: "Nivel 90",                icono: "📐",  cantidadDisponible: 5  },
  { codigo: "HER-034", nombre: "Pie de rey",              icono: "📏",  cantidadDisponible: 5  },
  { codigo: "HER-035", nombre: "Pinzas",                  icono: "🛠️", cantidadDisponible: 5  },
  { codigo: "HER-036", nombre: "Piqueta",                 icono: "⛏️", cantidadDisponible: 5  },
  { codigo: "HER-037", nombre: "Porta broca",             icono: "🔧",  cantidadDisponible: 5  },
  { codigo: "HER-038", nombre: "Segueta",                 icono: "🪚",  cantidadDisponible: 5  },
  { codigo: "HER-039", nombre: "Tarraja de 1/2x13",       icono: "🔧",  cantidadDisponible: 5  }
];