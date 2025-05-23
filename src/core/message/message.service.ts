import { Injectable } from '@nestjs/common';
import { BaileysSocketService } from '../session/baileys-socket/baileys-socket.service';
import { SessionStateService } from '../session/session-state/session-state.service';
import { MessageRepository } from '../message/message.repository';
import { MessageStatus } from 'src/common/enums/message-status.enum';
import { proto } from '@whiskeysockets/baileys';

@Injectable()
export class MessageService {
  constructor(
    private readonly baileysSocketService: BaileysSocketService,
    private readonly sessionStateService: SessionStateService,
    private readonly messageRepository: MessageRepository,
  ) { }

  /**
   * Envia uma mensagem e persiste ela no banco de dados.
   * @param sessionId ID da sessão do usuário
   * @param to Destinatário da mensagem
   * @param message Conteúdo da mensagem
   * @returns A mensagem enviada
   */
  async sendMessage(sessionId: string, to: string, message: string) {
    const socketExists = await this.baileysSocketService.hasSocket(sessionId);
    const sessionExists = this.sessionStateService.getSessionState(sessionId);

    if (!socketExists && !sessionExists) { throw new Error('Session does not exist'); }
    if (!socketExists && sessionExists) { throw new Error('Session exists but socket is missing'); }
    if (socketExists && !sessionExists) { throw new Error('Socket exists but session state is missing'); }

    // Envia a mensagem via Baileys
    const sentMessage = await this.baileysSocketService.sendMessage(sessionId, to, message);

    if (!sentMessage) {
      throw new Error('Failed to send message');
    }

    if (!sentMessage.key.id || !sentMessage.status) {
      throw new Error('The sent message did not return required params');
    }

    // Persiste a mensagem no banco de dados
    await this.messageRepository.create({
      messageId: sentMessage.key.id,
      to,
      content: message,
      sentAt: Date.now(),
      status: this.mapBaileysStatusToMessageStatus(sentMessage.status),
    });

    return sentMessage;
  }

  /**
   * Atualiza o status de uma mensagem existente.
   * @param messageId ID único da mensagem
   * @param status Novo status da mensagem
   */
  async updateMessageStatus(messageId: string, status: proto.WebMessageInfo.Status) {
    const messageStatus = this.mapBaileysStatusToMessageStatus(status);
    return this.messageRepository.updateStatus(messageId, messageStatus);
  }

  mapBaileysStatusToMessageStatus(status: proto.WebMessageInfo.Status): MessageStatus {
    console.log('mapBaileysStatusToMessageStatus', status);
    switch (status) {
      case 0: return MessageStatus.Error;
      case 1: return MessageStatus.Pending;
      case 2: return MessageStatus.ServerAck;
      case 3: return MessageStatus.DeliveryAck;
      case 4: return MessageStatus.Read;
      case 5: return MessageStatus.Played;
      default: return MessageStatus.Error;
    }
  }
}
