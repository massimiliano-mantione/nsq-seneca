declare module "nsqjs" {
  export interface Message {
    timestamp: number;
    attempts: number;
    id: string;
    hasResponded: boolean;
    body: Buffer;
    json(): Object;
    timeUntilTimeout(hard?: boolean);
    finish(): void;
    requeue(delay?: number, backoff?: boolean);
    touch(): void;
  }

  type WriterEvents = 'ready' | 'closed'
  type WriterErrorEvent = 'error'
  export interface WriterOptions {
     // false
    tls?: boolean;
    // true
    tlsVerification?: boolean;
    // false
    deflate?: boolean;
    // 0
    deflateLevel?: number;
     // false
    snappy?: boolean;
    // null
    clientId?: string;
  }
  export type NsqWriterMessage = string | Buffer | Object

  export class Writer {
    constructor (nsqdHost: string, nsqdPort: number, options: WriterOptions);
    connect(): void;
    close(): void;
    publish(topic: string, msgs: NsqWriterMessage | NsqWriterMessage[], callback?: (err) => void);
    static readonly READY: WriterEvents;
    static readonly CLOSED: WriterEvents;
    static readonly ERROR: WriterErrorEvent;
    on(event: WriterEvents, callback: () => void)
    on(event: WriterErrorEvent, callback: (err: any) => void)
  }

  export type ReaderEvents = 'message' | 'discard' | 'error'
  export type ReaderErrorEvent = 'message' | 'discard' | 'error'
  export type ReaderConnectionEvents = 'nsqd_connected' | 'nsqd_closed'
  export interface ReaderOptions extends WriterOptions {
    // 1
    maxInFlight?: number;
    // 30
    heartbeatInterval?: number;
    // 128
    maxBackoffDuration?: number;
    // 0
    maxAttempts?: number;
    // 90
    requeueDelay?: number; 
    nsqdTCPAddresses?: string | string[];
    lookupdHTTPAddresses?: string | string[];
    // 60
    lookupdPollInterval?: number;
    // 0.3
    lookupdPollJitter?: number;
    // null 
    authSecret?: string
    // null
    outputBufferSize?: number;
    // null
    outputBufferTimeout?: number;
    // null
    messageTimeout?: number;
    // null
    sampleRate?: number;
  }

  export class Reader {
    constructor (topic: string, channel: string, options: ReaderOptions);
    static readonly MESSAGE: ReaderEvents;
    static readonly DISCARD: ReaderEvents;
    static readonly ERROR: ReaderErrorEvent;
    static readonly NSQD_CONNECTED: ReaderConnectionEvents;
    static readonly NSQD_CLOSED: ReaderConnectionEvents;
    connect() : void;
    close() : void;
    pause() : void;
    unpause() : void;
    isPaused() : void;
    on(event: ReaderEvents, callback: (m: Message) => void)
    on(event: ReaderErrorEvent, callback: (err: any) => void)
    on(event: ReaderConnectionEvents, callback: (host: string, port: number) => void)
  }
}
