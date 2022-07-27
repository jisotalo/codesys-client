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

import { IecType } from "iec-61131-3/dist/types/types"

export interface ReceiverSettings {
  /**
   * UDP port to listen for incoming data
   * Default is 1202
   */
  ListeningPort?: number,

  /**
   * IP address of the network interface to use for listening
   * Default: 127.0.0.1
   */
  LocalAddress?: string
}



/**
 * A packet containing data for a list
 */
export interface Packet {
  /**
   * Packet header
   */
  header: PacketHeader,

  /**
   * Packet payload
   */
  payload: PacketData,
  
  /**
   * Raw data of the whole packet
   */
  rawData: Buffer
}

/**
 * Received packet header
 */
export interface PacketHeader {
  /** Raw header data */
  rawData: Buffer,
  /** Codesys header identity */
  identity: Buffer,
  /** Message type (0 = network variable) */
  type: number,
  /** Index - Network variable list ID (Listidentifier at PLC) */
  index: number,
  /** SubIndex - If multiple packets -> number of the packet  */
  subIndex: number
  /** Variable count - how many variables */
  variableCount: number,
  /** Byte length of the whole packet inc. header */
  packetLength: number,
  /** Increasing counter value*/
  counter: number,
  /** Flags */
  flags: number,
  /** Flags as string array */
  flagsStr: string[],
  /** Checksum of the variable definiton, changes only if variables added/removed (if sent, otherwise 0) */
  checksum: number,
  /** Length of the data payload (calculated by ourselves)*/
  payloadLength: number

}
export interface PacketData {
  rawData: Buffer,
  parsed: Record<string, unknown>
}


export interface PacketBufferEntry {
  handled: boolean,
  counter: number,
  packets: Packet[],
  totalDataBytes: number
}


export interface Listener {
  listID: number,
  dataType: IecType,
  callback: (data: unknown, listener: Listener) => void
}



export interface SenderSettings {
  /**
   * Target IP address / broadcast address to send data to
   * Default is 255.255.255.255 (broadcast)
   */
  targetAddress? : string,
  /**
   * UDP port to send outgoing data
   * Default is 1202
   */
  targetPort?: number,

  /**
   * Time delay (milliseconds) between packets sent
   * Default is 5 ms
   */
  delayBetweenPackets? : number
}
