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
import { writeFile } from 'fs/promises'

/**
 * EXPERIMENTAL: Creates a NVL xxx.GVL file as string for Codesys to import
 * @param listID 
 * @param udpPort 
 * @param declaration 
 * @returns 
 */
export const createNvlString = (listID: number, udpPort: number, declaration: string): string => {
  return `<GVL>
<Declarations><![CDATA[{attribute 'qualified_only'}
VAR_GLOBAL
${declaration}
END_VAR]]></Declarations>
<NetvarSettings Protocol="UDP">
  <ListIdentifier>${listID}</ListIdentifier>
  <Pack>True</Pack>
  <Checksum>False</Checksum>
  <Acknowledge>False</Acknowledge>
  <CyclicTransmission>True</CyclicTransmission>
  <TransmissionOnChange>False</TransmissionOnChange>
  <TransmissionOnEvent>False</TransmissionOnEvent>
  <Interval>T#10ms</Interval>
  <MinGap>T#10ms</MinGap>
  <EventVariable>
  </EventVariable>
  <ProtocolSettings>
    <ProtocolSetting Name="Broadcast Adr." Value="255.255.255.255" />
    <ProtocolSetting Name="Port" Value="${udpPort}" />
  </ProtocolSettings>
</NetvarSettings>
</GVL>`;
}

/**
 * EXPERIMENTAL: Creates a NVL xxx.GVL file for Codesys to import.
 * 
 * @param listID 
 * @param udpPort 
 * @param declaration 
 * @param filename 
 */
export const createNvlFile = async (listID: number, udpPort: number, declaration: string, filename: string): Promise<void> => {
  await writeFile(filename, createNvlString(listID, udpPort, declaration));
}