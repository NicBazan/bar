-- Una sola sesión activa por mesa: evita que dos celulares que escanean a la vez abran dos sesiones
CREATE UNIQUE INDEX "TableSession_one_active_per_table"
  ON "TableSession" ("tableId")
  WHERE "status" <> 'CLOSED';
