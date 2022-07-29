# codesys-client

[![npm version](https://img.shields.io/npm/v/codesys-client)](https://www.npmjs.org/package/codesys-client)
[![GitHub](https://img.shields.io/badge/View%20on-GitHub-brightgreen)](https://github.com/jisotalo/codesys-client)
[![License](https://img.shields.io/github/license/jisotalo/codesys-client)](https://choosealicense.com/licenses/mit/)

Node.js Codesys client for reading and writing PLC data using network variable lists (NVL).

Uses my other library [iec-61131-3](https://github.com/jisotalo/iec-61131-3) (MIT) to convert between Javascript and PLC variables.

Supports arbitrary length data including single variables, structs, single- and multi-dimensional arrays and so on.

Inspiration from *Network Functionality in CoDeSys V2.3 (PDF)* (https://forge.codesys.com/forum/en/124/genmed-Network_Functionality_V23.pdf) and EasyNetVars C# library (https://sourceforge.net/projects/easynetvars/).

# Project status

<span style="color:red;font-size:1.5em;">This project is in early stage. Do not use this for anything critical!</span>

**Things that should work**
  * Receiving (reading) any kind of variables
  * Sending (writing) any kind of variables

**Things to do until releasing version 1.0.0**
  * Testing more use cases
  * More error checking
  * Adding some basic end-to-end tests using Jest
  * Improving network variable list definition exporter
  * Updating EADME with more examples
  * Adding possibility to access received raw data

**This to do at some point**
  * Adding checksum feature (need to find out how it is calculated)
  * Adding "Use acknowledged transfer" support to makse sure write is successful


# Table of contents
- [Installing](#installing)
- [License](#license)

# Installing
Install the [npm package](https://www.npmjs.com/package/codesys-client) using npm command:
```bash
npm i codesys-client
```

# Example: Receiving (reading) data

## Codesys PLC side

1. Create network variable list (sender)
    * Select UDP as network type
    * Enter desired Listidentifier number (`listID` in codesys-client)
    * Enable `Pack variables` to optimize data usage
    * Set transimission interval etc. to desired values
    
    ![image](https://user-images.githubusercontent.com/13457157/181267626-946b77b5-5e90-4472-a8bb-ef3e83ab9e6c.png)


2. Edit UDP settings pressing `Settings...` button
    * Keep `Port` as default value 1202 or change it to something else
      * **NOTE:** When running soft-PLC and codesys-client on the same system, the PLC is most probably reserving default port --> you need to use different port. 
      * In this example port is set to `12020` --> codesys-client needs to listen to that port.
    * Keep `Broadcast Adr.` as default 255.255.255.255 unless you want to send the data to a specific IP only
      * 255.255.255.255 -> data is sent to whole network


    ![image](https://user-images.githubusercontent.com/13457157/181268626-94f05114-c323-4417-ad23-8fbfa34b3d85.png)

3. Accept settings and press `Add`
4. Add variables to network variable list
    * You can add separate variables or encapsulate all data under one `STRUCT`
    * Encapsulating might be a good idea as in codesys-client you will need one "master object" to contain all data


    ![image](https://user-images.githubusercontent.com/13457157/181270008-312f91fd-9181-4d30-98bb-e885f3c07f07.png)

    `NVL_SendTest`:
    ```
    {attribute 'qualified_only'}
    VAR_GLOBAL
      DataToSend : ST_DataToSend;
    END_VAR
    ```

    `ST_DataToSend`:
    ```
    TYPE ST_DataToSend :
    STRUCT
      IntValue  : INT := 12345;
      RealValue	: REAL := 3.14;
      StringValue	: STRING := 'Hello from Codesys PLC';
      ArrValue	: ARRAY[0..4] OF INT := [1, 2, 3, 4, 5];
      StructValue	: ST_ChildStruct;
    END_STRUCT
    END_TYPE
    ```

    `ST_ChildStruct`:
    ```
    TYPE ST_ChildStruct :
    STRUCT
      StringValue2 : STRING(255) := 'Hi from child struct';
      ArrayOfArray : ARRAY[1..2] OF ARRAY[1..2] OF INT := [[1, 2,], [3, 4]];
    END_STRUCT
    END_TYPE
    ```

  5. PLC side is ready. Download program and set it to run.

  ## Javascript/codesys-client side

  1. Install library using `npm i codesys-client`
  2. Add the following to file (`example-receive.js` for example) and then run it using `node example-receive.js`

```js
const { Receiver } = require('codesys-client');
const iec = require('iec-61131-3');

const util = require('util'); //util needed only for demo purposes

//Setting up new receiver
const receiver = new Receiver({
  ListeningPort: 12020 //UDP port defined in PLC (see above)
});

//Creating IEC datatype schema
//See https://github.com/jisotalo/iec-61131-3 for more info
//Note that default values have no meaning here (just copy-pasted)
const ST_DataToSend = iec.fromString(`
  TYPE ST_DataToSend :
  STRUCT
    IntValue 	: INT := 12345;
    RealValue	: REAL := 3.14;
    StringValue	: STRING := 'Hello from Codesys PLC';
    ArrValue	: ARRAY[0..4] OF INT := [1, 2, 3, 4, 5];
    StructValue	: ST_ChildStruct;
  END_STRUCT
  END_TYPE

  TYPE ST_ChildStruct :
  STRUCT
    StringValue2 : STRING(255) := 'Hi from child struct';
    ArrayOfArray : ARRAY[1..2] OF ARRAY[1..2] OF INT := [[1, 2], [3, 4]];
  END_STRUCT
  END_TYPE
`, 'ST_DataToSend');

//Adding data handler(s)
receiver.addHandler(50, ST_DataToSend, (data) => {
  //data is now as object that matches ST_DataToSend
  //Using util.inspect to display the whole object for demo purposes
  console.log(new Date(), `- received data for listID 50:`, util.inspect(data, false, 999));
});

//Starting to listen for incoming data
receiver.listen()
  .then(res => console.log(`Listening UDP now to:`, res))
  .catch(err => console.log(`Failed to start listening. Error:`, err));

/*
Console output:

Listening UDP now to: { address: '0.0.0.0', family: 'IPv4', port: 12020 }
2022-07-27T14:41:05.332Z - received data for listID 50: {
  IntValue: 12345,
  RealValue: 3.140000104904175,
  StringValue: 'Hello from Codesys PLC',
  ArrValue: [ 1, 2, 3, 4, 5 ],
  StructValue: {    StringValue2: 'Hi from child struct',
    ArrayOfArray: [ [ 1, 2 ], [ 3, 4 ] ]
  }
}
2022-07-27T14:41:06.323Z - received data for listID 50: {
  IntValue: 12345,
  RealValue: 3.140000104904175,
  StringValue: 'Hello from Codesys PLC',
  ArrValue: [ 1, 2, 3, 4, 5 ],
  StructValue: {    StringValue2: 'Hi from child struct',
    ArrayOfArray: [ [ 1, 2 ], [ 3, 4 ] ]
  }
}
*/
```


# Example: Sending (writing) data

The sending of the data is a little bit more complicated from codeys PLC side as the network variable list needs to be imported from `.GVL` file.

## Creating GVL file
1. Open web page https://jisotalo.github.io/others/nvl-file-generator.html or `nvl-file-generator.html` in the root directory.
2. Enter details and copy-paste variable declaration for network variable list
    * Filename: `NVL_ReceiveTest.GVL`
    * List ID: `100`
    * UDP port: `12023`
    * Declaration:
```
{attribute 'qualified_only'}
VAR_GLOBAL
  DataToReceive : ST_Data;
END_VAR
```

3. Press `Download .GVL file` and save the produced file locally somewhere (will be used in next chapter).

![image](https://user-images.githubusercontent.com/13457157/181707384-d64eda07-782b-40ce-a4d1-48c1ef16aa9d.png)


## Codesys PLC side
1. Create network variable list (receiver)
    * Set name as `NVL_ReceiveTest`
    * Select previously create `NVL_ReceiveTest.GVL` file


    ![image](https://user-images.githubusercontent.com/13457157/181291327-25a78cdf-d4e9-4e52-aa1c-f5beaa6c9095.png)

2. Press Add. The NVL is now added.

    ![image](https://user-images.githubusercontent.com/13457157/181348931-82be425e-1cae-4569-a18d-065722b0a5a9.png)

3. Download PLC software and set it to run mode

## Javascript/codesys-client side

  1. (Install library using `npm i codesys-client` if not yet installed)
  2. Add the following to file (`example-send.js` for example)
```js
const { Sender } = require('codesys-client');
const iec = require('iec-61131-3');

//Setting up new sender
const sender = new Sender({
  targetPort: 12023 //UDP port defined in NVL (see above)
});

//Creating IEC datatype schema
//See https://github.com/jisotalo/iec-61131-3 for more info
//Note that default values have no meaning here (just copy-pasted)
const ST_Data = iec.fromString(`
  TYPE ST_Data :
  STRUCT
    IntValue 	: INT := 12345;
    RealValue	: REAL := 3.14;
    StringValue	: STRING := 'Hello from Codesys PLC';
    ArrValue	: ARRAY[0..4] OF INT := [1, 2, 3, 4, 5];
    StructValue	: ST_ChildStruct;
  END_STRUCT
  END_TYPE

  TYPE ST_ChildStruct :
  STRUCT
    StringValue2 : STRING(255) := 'Hi from child struct';
    ArrayOfArray : ARRAY[1..2] OF ARRAY[1..2] OF INT := [[1, 2], [3, 4]];
  END_STRUCT
  END_TYPE
`, 'ST_Data');

const data = {
  IntValue: 0,
  RealValue: 12345.67,
  StringValue: 'Hello from Node.js',
  ArrValue: [99, 88, 77, 66, 55],
  StructValue: {
    StringValue2: 'Example value from Node.js',
    ArrayOfArray: [[9, 8], [7, 6]]
  }
};

setInterval(() => {
  //Updating some values to see result at PLC
  data.IntValue = new Date().getSeconds();
  data.StructValue.ArrayOfArray[0][1] = new Date().getSeconds();

  sender.send(100, ST_Data, data)
    .then(() => console.log(`Data sent!`))
    .catch(err => console.log(`Failed to send data. Error:`, err));
}, 1000);
```
3. Start the script `node example-send.js`
4. The values are written every 1s and the result can be seen from PLC:

![image](https://user-images.githubusercontent.com/13457157/181347664-2d18e26f-38f4-4186-87c9-c61c9ada17e4.png)


# Problems
If you have any problems, check
* UDP ports used
* Data type schemas (are they 1:1)
* List IDs
* etc.

Then double check again..

# License

Licensed under [MIT License](http://www.opensource.org/licenses/MIT) so commercial use is possible. Please respect the license, linking to this page is also much appreciated.

Copyright (c) 2022 Jussi Isotalo <<j.isotalo91@gmail.com>>

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
