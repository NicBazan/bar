// Contratos compartidos entre la API y los frontends (guest-web, staff-web).
import { z } from "zod";

// ───── Sesión de mesa ─────

export const JoinSessionBody = z.object({
  deviceKey: z.string().min(8).max(64),
  pin: z.string().regex(/^\d{4}$/).optional(),
});
export type JoinSessionBody = z.infer<typeof JoinSessionBody>;

// ───── Pedidos ─────

export const OrderItemInput = z.object({
  dishId: z.uuid(),
  variantId: z.uuid().optional(),
  modifierIds: z.array(z.uuid()).max(20).default([]),
  quantity: z.number().int().min(1).max(20),
  note: z.string().trim().max(200).optional(),
});
export type OrderItemInput = z.infer<typeof OrderItemInput>;

export const CreateOrderBody = z.object({
  items: z.array(OrderItemInput).min(1).max(30),
  note: z.string().trim().max(300).optional(),
});
export type CreateOrderBody = z.infer<typeof CreateOrderBody>;

export const RejectOrderBody = z.object({
  reason: z.string().trim().min(1).max(200),
});

export const ItemStatus = z.enum(["FIRED", "IN_PROGRESS", "READY", "SERVED", "VOIDED"]);
export const UpdateItemStatusBody = z.object({
  status: ItemStatus,
  reason: z.string().trim().max(200).optional(),
});

// ───── Llamados ─────

export const CreateServiceCallBody = z.object({
  type: z.enum(["WAITER", "BILL"]),
});

// ───── Staff ─────

export const StaffLoginBody = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

// ───── Tiempo real ─────

export const StateQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
});

export type RealtimeEventType =
  | "session.requested"
  | "session.opened"
  | "session.closed"
  | "session.pin_changed"
  | "menu.updated"
  | "order.submitted"
  | "order.approved"
  | "order.rejected"
  | "item.status_changed"
  | "service_call.created"
  | "service_call.updated";
