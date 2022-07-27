/*
Copyright (c) 2022 Jussi Isotalo <j.isotalo91@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import type {
  RemoteInfo,
  Socket
} from 'dgram'
import { EventEmitter } from 'events'
import dgram from 'dgram'
import { AddressInfo } from 'net'
import {
  Listener,
  PacketBufferEntry,
  ReceiverSettings,
  Packet,
  PacketHeader
} from './types/types'
import Debug from 'debug'
import type { IecType } from 'iec-61131-3'

export class Receiver extends EventEmitter {
  private debug = Debug(`codesys-client-receiver`);
  private debugD = Debug(`codesys-client-receiver:details`);
  private debugIO = Debug(`codesys-client-receiver:raw-data`);

  /**
   * Active debug level
   *  - 0 = no debugging
   *  - 1 = basic debugging (same as $env:DEBUG='codesys-client-receiver')
   *  - 2 = detailed debugging (same as $env:DEBUG='codesys-client-receiver,codesys-client-receiver:details')
   *  - 3 = full debugging (same as $env:DEBUG='codesys-client-receiver,codesys-client-receiver:details,codesys-client-receiver:raw-data')
   */
  public debugLevel = 0;

  /**
   * Active settings
   */
  public settings: ReceiverSettings = {
    ListeningPort: 1202
  };

  /**
   * Socket instance
   */
  private socket?: Socket = undefined;

  /**
   * Buffer for each list ID of incomplete packets
   * (data is still coming up)
   */
  private packetBuffer: Record<number, PacketBufferEntry> = {};

  /**
   * Array handlers added by user
   */
  handlers: Listener[] = [];

  /**
   * Constructor
   * 
   * @param settings Settings object
   */
  constructor(settings?: ReceiverSettings) {
    super();

    //Updating all provided settings, other left as default
    this.settings = {
      ...this.settings,
      ...settings
    };

    this.debug(`Receiver(): initialized with settings %o`, this.settings);
  }

  /**
   * Sets debugging using debug package on/off. 
   * Another way for environment variable DEBUG:
   *  - 0 = no debugging
   *  - 1 = basic debugging (same as $env:DEBUG='codesys-client-receiver')
   *  - 2 = detailed debugging (same as $env:DEBUG='codesys-client-receiver,codesys-client-receiver:details')
   *  - 3 = full debugging (same as $env:DEBUG='codesys-client-receiver,codesys-client-receiver:details,codesys-client-receiver:raw-data')
   * 
   * @param level 0 = none, 1 = basic, 2 = detailed, 3 = detailed + raw data
   */
  setDebugging(level: number): void {
    this.debugLevel = level;

    this.debug.enabled = level >= 1;
    this.debugD.enabled = level >= 2;
    this.debugIO.enabled = level >= 3;

    this.debug(`setDebugging(): Debug level set to ${level}`);
  }

  /**
   * Starts listening for incoming data from 
   * the UDP port (and interface) provided in settings
   */
  listen(): Promise<AddressInfo> {
    return new Promise(async (resolve, reject) => {
      this.debug(`listen(): Starting listening UDP port ${this.settings.LocalAddress ? this.settings.LocalAddress : ''}:${this.settings.ListeningPort}`);

      if (this.socket) {
        this.debug(`listen(): Failed to start listening - there is already a connection`);
        return reject(`Failed to start listening - there is already a connection`);
      }

      const socket = dgram.createSocket({
        type: 'udp4',
        reuseAddr: true
      });
      this.socket = socket;

      this.debug(`listen(): UDP socket created`);

      const bindingErrorEvent = (err: Error) => {
        //Error during binding
        this.debug(`listen(): Binding to UDP port ${this.settings.LocalAddress ? this.settings.LocalAddress : ''}:${this.settings.ListeningPort} failed - ${err}`);
        return reject(`Binding to UDP port ${this.settings.LocalAddress ? this.settings.LocalAddress : ''}:${this.settings.ListeningPort} failed - ${err}`);
      }

      socket.on('error', bindingErrorEvent);

      try {
        socket.bind(this.settings.ListeningPort, this.settings.LocalAddress, () => {
          //Binding successful
          this.debug(`listen(): UDP socket successfully binded, listening started`);

          //Removing listeners used during connection
          socket.off('error', bindingErrorEvent);

          //Adding data listener + error listener
          socket.on('error', (err) => this.handleSocketError(err));
          socket.on('message', (data, info) => this.handleReceivedData(data, info));

          resolve(socket.address());
        })

      } catch (err) {
        //Binding to port failed ("In rare case (e.g. attempting to bind with a closed socket), an Error may be thrown")
        this.debug(`listen(): Binding to UDP port ${this.settings.LocalAddress ? this.settings.LocalAddress : ''}:${this.settings.ListeningPort} failed - ${err}`);
        reject(`Binding to UDP port ${this.settings.LocalAddress ? this.settings.LocalAddress : ''}:${this.settings.ListeningPort} failed - ${err}`);
      }
    })
  }

  /**
   * Stops listening for incoming data
   */
  close(): Promise<void> {
    return new Promise(async resolve => {
      this.debug(`close(): Closing socket end stopping listening`);

      //Removes socket and cleans everything up
      const cleanup = () => {
        this.socket?.removeAllListeners();

        delete this.socket;
        this.handlers = [];
        this.packetBuffer = {};
      }

      if (!this.socket) {
        this.debug(`close(): No open socket available`);
        cleanup();
        return resolve();
      }

      try {
        this.socket.close(() => {
          this.debug(`close(): Socket closed successfully`);
          cleanup();
          resolve();
        })

      } catch (err) {
        this.debug(`close(): Socket closing failed, error: ${err}`);
        cleanup();
        resolve();
      }
    })
  }

  /**
   * Adds a new data handler callback for incoming data. 
   * Callback is called with received data if listID matches
   *  
   * @param listID List ID ("Listidentifier") of the network variable list (NVL)
   * @param dataType IEC-61131-3 data type schema of the provided data (like iec.INT, iec.STRUCT, etc.)
   * @param callback Callback to be called when data is received
   * @returns 
   */
  addHandler<T>(listID: number, dataType: IecType, callback: (data: T, listener: Listener) => void): Listener {
    const handler = {
      listID,
      dataType,
      callback
    } as Listener;

    this.handlers.push(handler);
    return handler;
  }

  /**
   * Removes the given handler from handler list 
   * and stops calling its callback
   * @param handler Handler to be removed - created previously with addHandler()
   */
  removeHandler(handler: Listener): void {
    this.handlers = this.handlers.filter(x => x !== handler);
  }

  /**
   * Removes all registered handlers
   */
  removeAllHandlers(): void {
    this.handlers = [];
  }

  /**
   * Callback for socket errors
   * @param err 
   */
  private handleSocketError(err: Error) {
    this.debug(`handleSocketError(): Socket error occured: ${err}`);
    this.emit('socket-error', err);
  }

  /**
   * Handles received data from socket
   * 
   * @param data 
   * @param info 
   */
  private handleReceivedData(data: Buffer, info: RemoteInfo) {
    this.debugD(`handleReceivedData(): Data received (${data.byteLength} bytes) from ${info.address}:${info.port}`);

    //Todo: Adding to data buffer if < 20 bytes?
    this.parseReceivedPacket(data)
  }

  /**
   * Parses received from byte buffer to object
   * @param data 
   */
  private parseReceivedPacket(data: Buffer) {
    const packet = {} as Packet;

    //Header
    packet.header = this.parseReceivedPacketHeader(data);

    //Payload
    packet.payload = {
      rawData: data.slice(packet.header.rawData.byteLength),
      parsed: {}
    };

    //Raw data
    packet.rawData = data;

    this.debugD(`parseReceivedPacket(): Received packet for list index ${packet.header.index} (subindex ${packet.header.subIndex})`);
    this.handleReceivedPacket(packet);
  }

  /**
   * Parses header from received data
   * @param data
   * @returns 
   */
  private parseReceivedPacketHeader(data: Buffer): PacketHeader {
    const header = {} as PacketHeader;

    if (data.byteLength < 20) {
      //TODO  
    }

    header.rawData = data.slice(0, 20);
    let pos = 0;

    //0..3 - Identity
    header.identity = data.slice(pos, 4);
    pos += 4;

    //4..7 - Type (0 = network variable)
    header.type = data.readUInt32LE(pos);
    pos += 4;

    //8..9 - Index (list ID)
    header.index = data.readUInt16LE(pos);
    pos += 2;

    //10..11 - SubIndex
    header.subIndex = data.readUInt16LE(pos);
    pos += 2;

    //12..13 - Variable count
    header.variableCount = data.readUInt16LE(pos);
    pos += 2;

    //14..15 - Packet total length
    header.packetLength = data.readUInt16LE(pos);
    pos += 2;

    //16..17 - Increasing counter
    header.counter = data.readUInt16LE(pos);
    pos += 2;

    //19 - Flags
    header.flags = data.readUInt8(pos);
    header.flagsStr = this.parseHeaderFlags(header.flags);
    pos += 1;

    //20 - Checksum
    header.checksum = data.readUInt8(pos);
    pos += 1;

    //Payload length (not part of codesys header)
    header.payloadLength = header.packetLength - 20;

    return header;
  }

  /**
   * Parses header flags as string from bits
   * @param flags 
   * @returns 
   */
  private parseHeaderFlags(flags: number): string[] {
    const flagsStr: string[] = [];

    //Bit 0 - Send-acknowledgement desired
    if ((flags & 0x01) === 0x01)
      flagsStr.push('SendAckRequested');

    //Bit 1 - Check of checksum desired
    if ((flags & 0x02) === 0x02)
      flagsStr.push('ChecksumIncluded');

    //Bit 2 - Invalid checksum
    if ((flags & 0x04) === 0x04)
      flagsStr.push('InvalidChecksum');

    return flagsStr;
  }

  /**
   * Handles received packet and adds to packet buffer
   * @param packet 
   */
  private handleReceivedPacket(packet: Packet) {
    this.debugD(`handleReceivedPacket(): Received a packet for list ID ${packet.header.index}`);

    let buffer: PacketBufferEntry | undefined = this.packetBuffer[packet.header.index];

    if (buffer && buffer.counter === packet.header.counter) {
      //There is already data for this list (counter is the same)
      //If subindex has increased by one, this is the next one -> OK
      if (packet.header.subIndex === buffer.packets[buffer.packets.length - 1].header.subIndex + 1) {
        buffer.packets.push(packet);
        buffer.totalDataBytes += packet.payload.rawData.byteLength;
        this.debugD(`handleReceivedPacket(): There was already data for this list, now total data of ${buffer.totalDataBytes} bytes buffered`);

      } else {
        //Something is missing in between. Just delete what we have (= packet is lost)
        this.debugD(`handleReceivedPacket(): One or more packets are missing from list ID ${packet.header.index} - Packets lost.`);
        delete this.packetBuffer[packet.header.index];
        buffer = undefined;
      }

    } else {
      //Nothing in buffer for this list OR some packets have been lost in between
      if (buffer && !buffer.handled) {
        this.debug(`handleReceivedPacket(): No listener for list ID ${packet.header.index} or some packets were lost. Counter change from ${buffer.counter} to ${packet.header.counter}. We had ${buffer.totalDataBytes} bytes.`);
        delete this.packetBuffer[packet.header.index];
      }

      //If this packet is the first, start again
      if (packet.header.subIndex === 0) {
        this.debugD(`handleReceivedPacket(): First packet received for list ID ${packet.header.index}`);
        
        //Creating a new buffer for this counter value
        this.packetBuffer[packet.header.index] = {
          handled: false,
          counter: packet.header.counter,
          packets: [ packet ],
          totalDataBytes: packet.payload.rawData.byteLength
        };

        buffer = this.packetBuffer[packet.header.index];

      } else {
        //This is not the first packet, do nothing
        this.debugD(`handleReceivedPacket(): Packet number ${packet.header.subIndex} received for list ID ${packet.header.index} but no previous packets -> discarding`);
      }
    }

    if (buffer) {
      this.checkReceivedPacket(packet.header.index, buffer);
    }
  }

  /**
   * Checks if received packets are fully received
   * @param index 
   * @param buffer 
   */
  private checkReceivedPacket(index: number, buffer: PacketBufferEntry) {
    const listeners = this.handlers.filter(listener => listener.listID === index);

    if (listeners.length > 0) {
      //we have a listener(s) for this listID - do we have all data?
      //Note: Checking only the first listener at the moment (todo?)
      if (listeners[0].dataType.byteLength === buffer.totalDataBytes) {
        this.debug(`checkReceivedPacket(): Full packet received for list ID ${index} (${buffer.totalDataBytes} bytes)`);

        const data = this.convertBufferEntriesToPacket(buffer);

        for (const listener of listeners) {
          listener.callback(listener.dataType.convertFromBuffer(data), listener);
        }
        
        buffer.handled = true;

      } else if (listeners[0].dataType.byteLength > buffer.totalDataBytes) {
        //Full packet is not yet received
        this.debugD(`checkReceivedPacket(): Not enough data for full packet yet. We have ${buffer.totalDataBytes}/${listeners[0].dataType.byteLength} bytes for list ID ${index}`);

      } else {
        //We have more data than expected
        this.debug(`checkReceivedPacket(): Data sizes do not match for list ID ${index}. Received ${buffer.totalDataBytes} bytes but expecting ${listeners[0].dataType.byteLength} bytes`);
      }

    } else {
      //No listener for this list ID
      this.debug(`checkReceivedPacket(): Received data for list ID ${index} but no listeners registered -> discarding data and following packets`);
      delete this.packetBuffer[index];
    }
  }

  /**
   * Combines all received packets to one single packet
   * @param buffer 
   * @returns 
   */
  private convertBufferEntriesToPacket(buffer: PacketBufferEntry) {
    const data = Buffer.alloc(buffer.totalDataBytes);

    let pos = 0;

    buffer.packets.forEach(packet => {
      packet.payload.rawData.copy(data, pos)
      pos += packet.payload.rawData.byteLength
    });

    return data;
  }
}