import { WASocket, makeWASocket, DisconnectReason, ConnectionState, BaileysEventMap, AuthenticationState } from '@whiskeysockets/baileys';
import { Subject } from 'rxjs';
import { Boom } from '@hapi/boom';
import { AuthStateService } from './auth-state/auth-state.service';

export class WhatsAppSession {
  private socket: WASocket | null = null;
  private sessionEvents = new Subject<{ type: string; data?: any }>();
  private baileysEvents = new Subject<{ type: string; data?: any }>();
  private subscribedEvents: (keyof BaileysEventMap)[] = []; // Adicionamos esta lista para controlar os eventos aos quais estamos assinando
  private metaInfo: { [key: string]: any } = {}; // Armazena as meta informações

  constructor(private sessionId: string, private authService: AuthStateService) { }

  async iniciarSessao() {
    this.emitEvent('starting');
    await this.setupSocket();
  }

  async desconectar() {
    if (this.socket) { await this.socket.logout() }
  }

  private async reconectarSessao() {
    this.emitEvent('reconnecting');
    await this.setupSocket();
  }

  private async setupSocket() {
    const state = await this.authService.getAuthState(this.sessionId);

    this.socket = makeWASocket({ printQRInTerminal: true, auth: state, qrTimeout: 20000 });
    this.socket.ev.on('creds.update', async () => await this.onCredsUpdate());
    this.socket.ev.on('connection.update', async (update) => await this.onConnectionUpdate(update));

    this.subscribedEvents.push('connection.update', 'creds.update'); // Aqui, inscrevemos os eventos que que assinamos
  }

  private onQRCodeReceived(qr: string) {
    this.emitEvent('qr_code', qr);
  }

  // Novo método separado para o callback
  private async onCredsUpdate() {
    const state = await this.authService.getAuthState(this.sessionId);

    // Salva as credenciais atualizadas
    await this.authService.saveCreds(this.sessionId, state.creds);
    const authState = this.socket?.authState;
    this.setMetaInfo('phone', authState?.creds?.me?.id);
    this.setMetaInfo('phonePlatform', authState?.creds?.platform);

    // Emite o evento 'creds.update' com as meta informações
    this.baileysEvents.next({ type: 'creds.update', data: this.metaInfo });
  }

  // Novo método separado para o callback
  private async onConnectionUpdate(update: Partial<ConnectionState>) {
    // Atualiza o estado da conexão nas meta informações
    this.setMetaInfo('connectionState', update);

    // Emite o evento 'connection.update' com as meta informações
    this.baileysEvents.next({ type: 'connection.update', data: this.metaInfo });

    if (update.qr) this.onQRCodeReceived(update.qr);
    if (update.connection === 'open') await this.onSessionOpened();
    if (update.connection === 'close') await this.onSessionClosed(update);
  }

  private async onSessionOpened() {
    this.emitEvent('connected', this.metaInfo);
  }

  private async onSessionClosed(update: Partial<ConnectionState>) {
    const error = update.lastDisconnect?.error as Boom;
    const statusCode = error?.output?.statusCode;
    const restartRequired = statusCode === DisconnectReason.restartRequired;

    if (restartRequired) {
      this.emitEvent('unexpected_disconnection');
      await this.reconectarSessao();
    } else {
      // Chama desconectar para garantir que a sessão seja completamente encerrada
      await this.limparSessao();
    }
  }

  // Método para adicionar ou atualizar meta informação
  private setMetaInfo(key: string, value: any) {
    this.metaInfo[key] = value;
  }

  private async limparSessao() {
    // Emite o evento 'logged_out' aqui, já que é a função responsável por desconectar
    this.emitEvent('logged_out');

    // Completa o subject de eventos
    Promise.resolve().then(async () => {
      this.sessionEvents.complete(); // Completa o subject
      // Deleta as credenciais associadas à sessão
      await this.authService.deleteAuthState(this.sessionId);

      // Remove os listeners registrados
      this.subscribedEvents.forEach((event) => {
        this.socket?.ev.removeAllListeners(event);  // Remove listener específico
      });

      this.socket = null;
    });
  }

  private emitEvent(type: string, data?: any) {
    this.sessionEvents.next({ type, data });
  }

  get sessionEvents$() {
    return this.sessionEvents.asObservable();
  }

  get baileysEvents$() {
    return this.baileysEvents.asObservable();
  }
}
