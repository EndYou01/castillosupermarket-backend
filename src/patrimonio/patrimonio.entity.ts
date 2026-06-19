import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

// Foto del patrimonio en un momento dado, para ver la tendencia real (en USD).
@Entity("patrimonio_snapshots")
export class PatrimonioSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  // Capital disponible (líquido) al momento de la foto.
  @Column({ type: "double precision" })
  capital: number;

  // Inventario valorado al costo (Total invertido).
  @Column({ type: "double precision" })
  inventario: number;

  // Patrimonio total en CUP = capital + inventario.
  @Column({ type: "double precision" })
  totalCup: number;

  // Tasa del dólar (CUP por USD) según eltoque al momento de la foto.
  @Column({ type: "double precision", nullable: true })
  tasaUsd: number | null;

  // Patrimonio total en USD = totalCup / tasaUsd.
  @Column({ type: "double precision", nullable: true })
  totalUsd: number | null;

  @CreateDateColumn({ type: "timestamptz" })
  fecha: Date;
}
