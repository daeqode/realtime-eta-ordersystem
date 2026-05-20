import { Server } from "socket.io";
import type { Server as HttpServer } from "http";

let io: Server | null = null;

export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    // 클라이언트가 특정 매장 이벤트를 구독 (운영자 대시보드 / 대기 현황)
    socket.on("join:store", (storeId: number) => {
      socket.join(`store:${storeId}`);
    });

    // 클라이언트가 특정 주문 이벤트를 구독 (내 주문 추적)
    socket.on("join:order", (orderId: number) => {
      socket.join(`order:${orderId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}
