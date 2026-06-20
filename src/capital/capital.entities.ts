import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

// Tipos de movimiento que afectan el capital disponible.
export type TipoMovimiento =
  | "CONTEO"
  | "CIERRE"
  | "BAJA"
  | "COMPRA"
  | "AJUSTE"
  | "EXTRACCION"
  | "INYECCION";

// Capital disponible: una sola fila (singleton, id = 1) con el monto actual.
@Entity("capital")
export class Capital {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "double precision", default: 0 })
  monto: number;

  @UpdateDateColumn({ type: "timestamptz" })
  actualizadoEn: Date;
}

// Historial de cada cambio del capital, para auditar de dónde sube o baja.
@Entity("movimientos_capital")
export class MovimientoCapital {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 20 })
  tipo: TipoMovimiento;

  // Delta firmado: positivo suma, negativo resta.
  @Column({ type: "double precision" })
  monto: number;

  // Saldo del capital después de aplicar este movimiento.
  @Column({ type: "double precision" })
  saldoResultante: number;

  @Column({ type: "text", nullable: true })
  descripcion: string | null;

  // Datos extra del movimiento (p. ej. detalle de la baja) en JSON.
  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: "timestamptz" })
  fecha: Date;
}

// Registro de cada baja de inventario ("Dar Baja").
@Entity("bajas")
export class Baja {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar" })
  variantId: string;

  @Column({ type: "varchar", nullable: true })
  itemId: string | null;

  @Column({ type: "varchar" })
  itemName: string;

  @Column({ type: "double precision" })
  cantidad: number;

  // Costo unitario al momento de la baja (referencia, de Loyverse).
  @Column({ type: "double precision", default: 0 })
  costoUnitario: number;

  // Stock que tenía Loyverse antes y después de la baja (para auditar).
  @Column({ type: "double precision", nullable: true })
  stockAntes: number | null;

  @Column({ type: "double precision", nullable: true })
  stockDespues: number | null;

  // Parte del precio que se pagó: este monto se suma al capital disponible.
  @Column({ type: "double precision", default: 0 })
  partePagada: number;

  @Column({ type: "varchar", length: 60 })
  motivo: string;

  @CreateDateColumn({ type: "timestamptz" })
  fecha: Date;
}
