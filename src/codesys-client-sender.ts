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

import { EventEmitter } from 'events'
import dgram from 'dgram'
import {
  Packet,
  SenderSettings
} from './types/types'
import Debug from 'debug'
import type { IecType } from 'iec-61131-3'

export class Sender extends EventEmitter {
  private debug = Debug(`codesys-client-sender`);
  private debugD = Debug(`codesys-client-sender:details`);
  private debugIO = Debug(`codesys-client-sender:raw-data`);

  /**
   * Active debug level
   *  - 0 = no debugging
   *  - 1 = basic debugging (same as $env:DEBUG='codesys-client')
   *  - 2 = detailed debugging (same as $env:DEBUG='codesys-client,codesys-client:details')
   *  - 3 = full debugging (same as $env:DEBUG='codesys-client,codesys-client:details,codesys-client:raw-data')
   */
  public debugLevel = 0

  /**
   * Active settings
   */
  public settings: SenderSettings = {
    targetAddress: '255.255.255.255',
    targetPort: 1202,
    delayBetweenPackets: 5
  }

  /**
   * Next free counter number to use
   */
  private counterNumber = 0;

  /**
   * Constructor
   * 
   * @param settings Settings object
   */
  constructor(settings?: SenderSettings) {
    super();

    //Updating all provided settings, other left as default
    this.settings = {
      ...this.settings,
      ...settings
    };

    this.debug(`Sender() - initialized with settings %o`, this.settings);
  }

  /**
   * Sets debugging using debug package on/off. 
   * Another way for environment variable DEBUG:
   *  - 0 = no debugging
   *  - 1 = basic debugging (same as $env:DEBUG='codesys-client-sender')
   *  - 2 = detailed debugging (same as $env:DEBUG='codesys-client-sender,codesys-client-sender:details')
   *  - 3 = full debugging (same as $env:DEBUG='codesys-client-sender,codesys-client-sender:details,codesys-client-sender:raw-data')
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
   * Sends given data to address and port provided in settings
   * 
   * @param listID List ID ("Listidentifier") of the network variable list (NVL)
   * @param dataType IEC-61131-3 data type schema of the provided data (like iec.INT, iec.STRUCT, etc.)
   * @param data Data as object to be sent, must match dataType schema
   * @returns 
   */
  send(listID: number, dataType: IecType, data: unknown): Promise<void> {
    return new Promise(async (resolve, reject) => {
      this.debug(`send(): Sending ${dataType.byteLength} bytes of data to list ID ${listID} (data type: ${dataType.type})`);

      //Converting data to buffer
      const rawData = dataType.convertToBuffer(data);
      const packets: Packet[] = [];

      //Making sure counter number fits uint16
      if (this.counterNumber >= 65535) {
        this.counterNumber = 0;
      }
      const counterNo = this.counterNumber++;

      //Helper function for creating a packet
      const getEmptyPacket = (): Packet => (
        {
          header: {
            rawData: Buffer.alloc(0),
            identity: Buffer.from([0x00, 0x2d, 0x53, 0x33]),
            type: 0,
            index: listID,
            subIndex: 0,
            variableCount: 0,
            packetLength: 20, //20 = header length
            counter: counterNo, 
            flags: 0x00,
            flagsStr: [],
            checksum: 0,
            payloadLength: 0
          },
          payload: {
            parsed: {},
            rawData: Buffer.alloc(0)
          },
          rawData: Buffer.alloc(0)
        }
      );

      let packet = getEmptyPacket();

      //Looping through each element in IEC data type
      //Meaning each variable and array element one-by-one
      for (const element of dataType.elementIterator()) {
        //Packet maximum size is 256 -> create a next one if the data won't fit
        if (packet.header.payloadLength + element.type.byteLength > 256) {
          this.debugD(`send(): Active packet #${packets.length + 1} has no more space for ${element.type.byteLength} bytes -> creating a new packet`);
          
          //Next packet
          const next = getEmptyPacket();
          next.header.subIndex = packet.header.subIndex + 1;
          packets.push(packet);
          packet = next;
        }
        
        packet.header.variableCount++;
        packet.header.payloadLength += element.type.byteLength;
        packet.header.packetLength += element.type.byteLength;
        
        //Slicing the bytes for this element
        const elementRawData = rawData.slice(element.startIndex, element.startIndex + element.type.byteLength);

        //Adding data from this element to the buffer
        packet.payload.rawData = Buffer.concat([packet.payload.rawData, elementRawData]);
      }
      packets.push(packet);

      this.debugD(`send(): Data was separated to ${packets.length} packets`);

      //Creating raw data for each packet
      packets.forEach(p => {
        p.header.rawData = this.createPacketHeader(p);
        p.rawData = Buffer.concat([p.header.rawData, p.payload.rawData]);
      });

      this.debug(`send(): Sending data for list index ${listID} (total of ${packets.length} packets)`);

      const client = dgram.createSocket('udp4');
      
      client.on('error', (err) => {
        this.debug(`send(): Client error: ${err}`);
        reject(err);
      });
      
      //bind() needed to send to broadcast
      client.bind(async () => {
        client.setBroadcast(true);
  
        //Each packet one-by-one
        for (const p of packets) {
          this.debugD(`send(): Sending packet (${p.header.subIndex + 1}/${packets.length})...`);

          try {
            await this.sendPacket(client, p);

          } catch (err) {
            this.debug(`send(): Sending failed: ${err}`);

            try {
              client?.close();
            } catch (ex) {
              this.debugD(`send(): Closing socket after errors failed: ${ex}`);
            }

            return reject(err);
          }
          this.debugD(`send(): Sending packet (${p.header.subIndex + 1}/${packets.length}) done - waiting ${this.settings.delayBetweenPackets} ms until next one`);

          //Waiting a while in between
          await (async () => new Promise(resolve => setTimeout(resolve, this.settings.delayBetweenPackets)))();
        }  

        //All done -> resolve after closing client
        client.close(() => resolve());
      })
    })
  }

  /**
   * Creates header byte Buffer from object
   * @param data Packet object
   * @returns Buffer with raw header data
   */
  private createPacketHeader(packet: Packet): Buffer {
    const data = Buffer.alloc(20);
    let pos = 0;

    //0..3 - Identity
    packet.header.identity.copy(data, pos);
    pos += 4;

    //4..7 - Type
    data.writeUInt32LE(packet.header.type, pos);
    pos += 4;

    //8..9 - Index (list ID)
    data.writeUInt16LE(packet.header.index, pos);
    pos += 2;

    //10..11 - SubIndex
    data.writeUInt16LE(packet.header.subIndex, pos);
    pos += 2;

    //12..13 - Variable count
    data.writeUInt16LE(packet.header.variableCount, pos);
    pos += 2;

    //14..15 - data length
    data.writeUInt16LE(packet.header.packetLength, pos);
    pos += 2;

    //16..17 - Increasing counter
    data.writeUInt16LE(packet.header.counter, pos);
    pos += 2;

    //19 - Flags
    data.writeUInt8(packet.header.flags, pos);
    pos += 1;

    //20 - Checksum
    data.writeUInt8(packet.header.checksum, pos);
    pos += 1;

    return data;
  }

  /**
   * Helper for sending data
   * @param client UDP client instance
   * @param packet Packet to send
   * @returns 
   */
  private sendPacket(client: dgram.Socket, packet: Packet): Promise<void> {
    return new Promise(async (resolve, reject) => {
      this.debugD(`sendPacket(): Sending ${packet.rawData.byteLength} bytes to ${this.settings.targetAddress}:${this.settings.targetPort}..`);
      
      if (this.debugIO.enabled) {
        this.debugIO(`IO out ------> ${packet.rawData.byteLength} bytes : ${packet.rawData.toString('hex')}`);
      }
      
      client.send(packet.rawData, this.settings.targetPort, this.settings.targetAddress, (error, bytes) => {
        if (error != null) {
          this.debugD(`sendPacket(): Sending to ${this.settings.targetAddress}:${this.settings.targetPort} failed: ${error}`);
          return reject(error);
        }

        this.debugD(`sendPacket(): Sent ${bytes}/${packet.rawData.byteLength} bytes`);
        resolve();
      })
    })
  }
}