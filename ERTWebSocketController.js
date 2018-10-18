//****************************************************************************************************************************************** 
// ERTWebSocketController
//
// The ERTWebSocketController is a generic interface supporting the ability to connect and receive real-time streaming market data from the
// Elektron RealTime (ERT) services.  ERT services can be accessed directly via the Elektron Data Platform (EDP), locally through TREP or 
// from the Eikon desktop. The controller is intentionally designed as a reusable interface allowing appplication communcation to work with 
// any Javascript framework.
//
// Interface:
//
// Common Interface:
//      ERTWebSocketController()
//      ERTWebSocketController.requestData(rics, options={});
//      ERTWebSocketController.requestNews(rics, serviceName=null);
//      ERTWebSocketController.closeRequest(rics, domain="MarketPrice")
//      ERTWebSocketController.closeAllRequests()
//      ERTWebSocketController.loggedIn()
//      ERTWebSocketController.onStatus(eventFn)
//      ERTWebSocketController.onMarketData(eventFn)
//      ERTWebSocketController.onNews(eventFn)
//
// TREP/ADS-specific session interface:
//      ERTWebSocketController.connectADS(server, port, user, appId="256", position="127.0.0.1");
//
// EDP/ERT-specific session interface:
//      ERTWebSocketController.connectERT(server, port, access_token, appId="256", position="127.0.0.1");
//      ERTWebSocketController.refreshERT(opt)
//
// Status Events:
//      ERTWebSocketController.status
//
// Author:  Nick Zincone, Wasin Waeosri
// Version: 2.0
// Date:    October 2018.
//****************************************************************************************************************************************** 


const MRN_DOMAIN = "NewsTextAnalytics";

//
// ERTWebSocketController()
// Quote controller instance managing connection, login and message interaction to a TR Elektron WebSocket service.
//
function ERTWebSocketController() {  
    "use strict";
    
    this._loggedIn = false;
    this._statusCb = null;
    this._marketDataCb = null;
    this._newsStoryCb = null;
    this._msgCb = null;
    this._loginParams = {
        user: undefined,
        access_token: undefined,
        appID: "",
        position: ""
    };
    this._server = {
        server: undefined,
        port: undefined
    };

    // Manage our Request ID's required by the Elektron WebSocket interface
    let _requestIDs = {};
    let _openStreamTable = {};
    let _lastID = 1;    // 0 - reserved for login
    
    // ***************************************************************
    // _getNextID
    // Retrieve the next available ID
    // ***************************************************************
    this._getNextID = (ric, domain, cb) => {
        // Ensure the ID we return is valid
        if ( _lastID == Number.MAX_SAFE_INTEGER ) _lastID = 0;
        let nextID = _lastID;
        
        // If a request comes in for a batch, Elektron makes the assumption the ID's will be sequential from
        // the base request.  That is, we make a request for a batch of 2 items with ID:13.  The 2 items will
        // be given the IDs 14, 15 respectively.
        if ( Array.isArray(ric) ) {
            for (var i=0; i < ric.length; i++) {
                // Check an upper limit.  If reached roll over and start again.
                if ( _lastID == Number.MAX_SAFE_INTEGER ) _lastID = 1;
                _lastID++;
                
                // Assign the new ID
                this._assignNewID(ric[i] + ":" + domain, cb);
            }
        }
        else {
            // Assign the new ID
            this._assignNewID(ric + ":" + domain, cb);
            
            _lastID++;  
        }
        
        return(nextID);
    }
    
    // If we try to open the item under a new stream, Elektron will close the existing one and
    // open under the new one.  We must ensure our tables are up to date.
    this._assignNewID = (item, cb) => {
        if ( _openStreamTable.hasOwnProperty(item) )
            delete _requestIDs[_openStreamTable[item].id];
        
        _requestIDs[_lastID] = item;
        _openStreamTable[item] = {id: _lastID, processingCb: cb};       
    }
    
    
    // Retrieve the array of IDs for all the open streams.
    this._getOpenStreams = () => {
        let result = [];
        for (var i in _openStreamTable)
            result.push(_openStreamTable[i].id);
        
        return(result);
    }
    
    // Retrieve specific processing callback based on id.
    this._getCallback = (id) => {
        if ( _requestIDs.hasOwnProperty(id) )
            return( _openStreamTable[_requestIDs[id]].processingCb );
    }
    
    // Remove the item from our tables.  returns the ID associated with the request.
    this._removeItem = (item) => {
        let id = -1;
        
        if ( _openStreamTable.hasOwnProperty(item) ) {
            id = _openStreamTable[item].id;
            
            // clean up tables
            delete _requestIDs[_openStreamTable[item].id];
            delete _openStreamTable[item];
        }
        
        return(id);
    }
    
    
    // Remove the items, based on ID, from our table
    this._removeID = (id) => {
        if (_requestIDs.hasOwnProperty(id))
            this._removeItem(_requestIDs[id]);
    }       

    // Manage our News Envelope
    let _newsEnvelope = {};
    
    // A unique article is based on the unique key or ric+mrn_src+guid.  However, the ric is static so no need to
    // include as the key.
    this._getNewsEnvelope = (key) => {
        return(_newsEnvelope[key]);
    }
    
    this._setNewsEnvelope = (key, envelope) => {
        _newsEnvelope[key] = envelope;
    }
    
    this._deleteNewsEnvelope = (key) => {
        delete _newsEnvelope[key];
    }
}

//
// Status events
ERTWebSocketController.prototype.status = {
    processingError: 0,
    connected: 1,
    disconnected: 2,
    loginResponse: 3,
    msgStatus: 4,
    msgError: 5,
    tokenExpire: 6,
    refreshSuccess: 7
};

//
// ERTWebSocketController.connectADS(server, user, appId="256", position="127.0.0.1")
// Initiate an asynchronous connection request to the specified ADS server.  Upon successful connection, the 
// framework will automatically issue a login to using the supplied user/appId/position parameters.
//
// Parameters:
//      server      Address of the ADS Elektron WebSocket server.  Format: hostname:port.  Required.
//      user        DACs user ID.  Required.
//      appId       DACs application ID.  Optional.  Default: '256'.
//      position    DACs position.  Optional.  Default: '127.0.0.1'.
//
ERTWebSocketController.prototype.connectADS = function(server, port, user, appId="256", position="127.0.0.1") { 
    // Connect into our WebSocket server
    this.ws = new WebSocket(`ws://${server}:${port}/WebSocket`, "tr_json2");
    this.ws.onopen = this._onOpen.bind(this);
    this.ws.onmessage = this._onMessage.bind(this);
    this.ws.onclose = this._onClose.bind(this);
    this._loginParams.user = user;
    this._loginParams.appId = appId;
    this._loginParams.position = position;
    
    this._server.server = server;
    this._server.port = port;    
    
    return(this);
}

//
// ERTWebSocketController.connect(server, access_token, appId="256", position="127.0.0.1")
// Initiate an asynchronous connection request to the specified WebSocket ERT in Cloud server.  Upon successful connection, the 
// framework will automatically issue a login to using the supplied access_token/appId/position parameters.
//
// Parameters:
//      server       Address of the ADS Elektron WebSocket server.  Format: hostname:port.  Required.
//      access_token ERT AuthenticationToken.  Required.
//      appId        DACs application ID.  Optional.  Default: '256'.
//      position     DACs position.  Optional.  Default: '127.0.0.1'.
//
ERTWebSocketController.prototype.connectERT = function(server, port, access_token, appId = "256", position = "127.0.0.1") {
    // Connect into our WebSocket server
    this.ws = new WebSocket(`wss://${server}:${port}/WebSocket`, "tr_json2");
    this.ws.onopen = this._onOpen.bind(this);
    this.ws.onmessage = this._onMessage.bind(this);
    this.ws.onclose = this._onClose.bind(this);
    this._loginParams.access_token = access_token;
    this._loginParams.appId = appId;
    this._loginParams.position = position;
    
    this._server.server = server;
    this._server.port = port;

    return (this);
}

//
// ERTWebSocketController.refreshERT(opt)
// Initiate an asynchronous connection request to re-send a Login request message with refresh_token.  
//
// Parameters:
//      opt.access_token   EDP Authentication gateway access token.  Required.
//      opt.refresh_token  EDP Authentication gateway refresh token.  Required.
//
ERTWebSocketController.prototype.refreshERT = function(opt) {
    let seconds = '';
    if (opt['access_token']) this._loginParams.access_token = opt['access_token'];

    this._login({
        is_refresh_token: true
    });
}

//
// ERTWebSocketController.requestData(rics, options = {})
// Request market data from our WebSocket server.
//
// Parameters:
//      ric(s)    Reuters Instrument Codes defining the market data item. Required.  
//                Eg: 'TRI.N'              (Single)
//                Eg: ['TRI.N', 'AAPL.O']  (Batch)
//      options   Collection of properties defining the different options for the request.  Optional.
//          Options 
//          {
//              Service: <String>       // Name of service providing data. 
//                                      // Default: service defaulted within ADS.
//              Streaming: <Boolean>    // Boolean defining streaming (subscription) or Non-streaming (snapshot).  
//                                      // Default: true (streaming).
//              Domain: <String>        // Domain model for request.  
//                                      // Default: MarketPrice.
//              View: <Array>           // Fields to retrieve.  Eg: ["BID", "ASK"]
//                                      // Default: All fields.
//          }
//
ERTWebSocketController.prototype.requestData = function(rics, options={})
{
    if ( !this._loggedIn )
        return;
    
    console.log(`Requesting for item(s): ${rics}`);
    
    // Retrieve the next available ID
    let domain = (typeof options.Domain == "string" ? options.Domain : "MarketPrice");
    let cb = (typeof options.cb == "function" ? options.cb : this._marketDataCb);
    let id = this._getNextID(rics, domain, cb);
    
    // send marketPrice request message
    let marketPrice = {
        ID: id,
        Domain: domain,
        Key: {
            Name: rics
        }
    };

    // ******************
    // Parse options
    // ******************
    if ( typeof options.Service == "string" )
        marketPrice.Key.Service = options.Service;
    
    if ( typeof options.Streaming == "boolean" )
        marketPrice.Streaming = options.Streaming;
    
    if ( Array.isArray(options.View) )
        marketPrice.View = options.View;

    // Submit to server
    this._send(JSON.stringify(marketPrice)); 
};

//
// ERTWebSocketController.requestNews(rics, serviceName=null)
// Request the specified news content set from our WebSocket server.
//
// Parameters:
//      ric(s)       Name of the News content set.  Required.
//                   Valid news RICs are:
//                      MRN_STORY:    Real-time News (headlines and stories)
//                      MRN_TRNA:     News Analytics: Company and C&E assets
//                      MRN_TRNA_DOC: News Analytics: Macroeconomic News and Events
//                      MRN_TRSI:     News Sentiment Indices
//      serviceName  Name of service where news stream is collected.  Optional.  Default: service defaulted within ADS.
// 
ERTWebSocketController.prototype.requestNews = function(ric, serviceName=null)
{
    this.requestData(ric, {
            Service: serviceName, 
            Domain: MRN_DOMAIN, 
            cb: this._processNewsEnvelope 
        });
};

// ERTWebSocketController.closeRequest(rics, domain)
//
// Close the open stream based on the specified ric and domain.
//
// Parameters:
//      ric(s)       Reuters Instrument Codes defining the market data item. Required.
//                   Eg: 'TRI.N'   (Single item)
//                   Eg: ['TRI.N', 'AAPL.O']
//      domain       Domain model for request.  Optional.  Default: MarketPrice.
//   
ERTWebSocketController.prototype.closeRequest = function(ric, domain="MarketPrice")
{
    // Build id array
    let ids = [];
    
    if ( Array.isArray(ric) ) {
        for (var i=0; i < ric.length; i++)          
            ids.push(this._removeItem(ric[i] + ":" + domain));
    }
    else
        ids.push(this._removeItem(ric + ":" + domain));
    
    // Close the open streams...
    let close = {
        ID: (ids.length == 1 ? ids[0] : ids),
        Type: "Close"
    };

    // Submit to server
    this._send(JSON.stringify(close));
    
    return(this);
};

// ERTWebSocketController.closeAllRequests
//
// Close all outstanding streaming requests.
//   
ERTWebSocketController.prototype.closeAllRequests = function() 
{
    // Close all open Streams
    let ids = this._getOpenStreams();
    
    this._removeID(ids);
    
    // Close the open streams...
    let close = {
        ID: (ids.length == 1 ? ids[0] : ids),
        Type: "Close"
    };

    // Submit to server
    this._send(JSON.stringify(close));
    
    return(this);
};

//
// onStatus
// Capture all status events related to connections, logins and general message status.  
//
// Event function: f(eventCode, msg)
//    Parameters:
//      eventCode:  value representing the type of status event (See below)
//      msg:        Associated msg, if any, for the specified event (See below)
//
//      where code/msg is:
//          0 - processingError
//              msg contains text of error.
//          1 - connected
//              msg contains server we connected to.
//          2 - disconnected
//              msg contains server we disconnected from.
//          3 - login response
//              msg contains Elektron login response - see Elektron WebSocket API for details.
//          4 - msg status
//              msg contains Elektron status message - see Elektron WebSocket API for details.
ERTWebSocketController.prototype.onStatus = function(f) {
    if ( this.isCallback(f) ) this._statusCb = f;
}

//
// onMarketData
// Presents the market data refresh/update messages.
//
// Event function: f(msg)
//    Parameters:
//      msg: Elektron WebSocket market data message.  Refer to the Elektron WebSocket API documentation for details.
//
// Parameters:
//      msg - Elektron WebSocket market data message.  Refer to the Elektron WebSocket API documentation for details.
//      ric - Name of the News content set - See requestNews() method for valid News RICs.
//
ERTWebSocketController.prototype.onMarketData = function(f) {
    if ( this.isCallback(f) ) this._marketDataCb = f;
}

//
// onNews
// Presents the news contents to our callback.
//
// Event function: f(ric, msg)
//    Parameters:
//      ric: RIC identifying the News content set - See requestNews() method for valid News RICs.
//      msg: Contents of the News envelope for the associated content set (RIC).
//
ERTWebSocketController.prototype.onNews = function(f) {
    if ( this.isCallback(f) ) this._newsStoryCb = f;
}

//
// loggedIn
// Returns true if we are successfully logged into the Elektron WebSocket server.
//
ERTWebSocketController.prototype.loggedIn = function() {
    return(this._loggedIn);
}






//*********************************************************************************************************     
// _onOpen (WebSocket interface)
// We arrive here upon a valid connection to our Elektron WebSocket server.  Upon a valid connection,
// we issue a request to login to the server.
//*********************************************************************************************************   
ERTWebSocketController.prototype._onOpen = function() {
    // Report to our application interface
    if ( this.isCallback(this._statusCb) ) this._statusCb(this.status.connected, this._server);

    // Login to our WebSocket server
    this._login({});
};

//*********************************************************************************************************  
// _onClose (WebSocket interface)
// In the event we could not initially connect or if our endpoint disconnected our connection, the event
// is captured here.  We simply report and make note.
//*********************************************************************************************************
ERTWebSocketController.prototype._onClose = function (closeEvent) {
    this._loggedIn = false; 
    
    // Report to our application interface
    if ( this.isCallback(this._statusCb) ) this._statusCb(this.status.disconnected, this._server);
};

//*********************************************************************************************************      
// _onMessage (WebSocket interface)
// All messages received from our TR WebSocket server after we have successfully connected are processed 
// here.
// 
// Messages received:
//
//  Login response: Resulting from our request to login.
//  Ping request:   The WebSocket Server will periodically send a 'ping' - we respond with a 'pong'
//  Data message:   Refresh and update market data messages resulting from our item request
//*********************************************************************************************************  
ERTWebSocketController.prototype._onMessage = function (msg) 
{
    // Ensure we have a valid message
    if (typeof (msg.data) === 'string' && msg.data.length > 0)
    {
        try {
            // Parse the contents into a JSON structure for easy access
            let result = JSON.parse(msg.data);

            // Our messages are packed within arrays - iterate
            let data = {}
            for (var i=0, size=result.length; i < size; i++) {
                data = result[i];
                
                // Did we encounter a PING?
                if ( data.Type === "Ping" ) {
                    // Yes, so send a Pong to keep the channel alive
                    this._pong();
                } else if ( data.Domain === "Login" ) { // Did we get our login response?
                    // Yes, process it. Report to our application interface
                    this._loggedIn = data.State.Data === "Ok";
                    if ( this.isCallback(this._statusCb) ) this._statusCb(this.status.loginResponse, data);
                } else if ( data.Type === "Status" ) {
                    // Issue on our message stream.  Make our ID available is stream is closed.
                    if ( data.State.Stream == "Closed") this._removeID(data.ID);
                    
                    // Report potential issues with our requested market data item
                    if ( this.isCallback(this._statusCb) ) this._statusCb(this.status.msgStatus, data);                        
                } else if ( data.Type === "Error" ) {
                    // Report the invalid usage error
                    if ( this.isCallback(this._statusCb) ) this._statusCb(this.status.msgError, data);
                } else {
                    // Otherwise, we must have received some kind of market data message.       
                    // First, retrieve the processing callback.  
                    // Note: the processing callback is defined when a user requests for data 
                    //       via requestData() or requestNews()
                    this._msgCb = this._getCallback(data.ID);
                    
                    // Next, update our ID table based on the refresh
                    if ( data.Type === "Refresh" && data.State.Stream === "NonStreaming" ) this._removeID(data.ID);
                    
                    // Process the message
                    if ( this.isCallback(this._msgCb) ) this._msgCb(data);
               }
            }
        }
        catch (e) {
            // Processing error.  Report to our application interface
            console.log(e);
            if ( this.isCallback(this._statusCb) ) this._statusCb(this.status.processingError, e.message);
        }       
    }
}

//********************************************************************************************************* 
// _processNewsEnvelope
// We received an MRN news message which is an envelop around the specific details of the news contents.
// Preprocess this envelop prior to sending off to the news application callback.
//
// Note: this routine is only executed if application requested for news using the convenient method
//       call: requestNews().
//********************************************************************************************************* 
ERTWebSocketController.prototype._processNewsEnvelope = function(msg)
{
    try {
        // We ignore the MRN Refresh envelope and ensure we're dealing with a 'NewsTextAnalytics' domain.    
        if ( msg.Type === "Update" && msg.Domain === MRN_DOMAIN ) {
            //********************************************************************************
            // Before we start processing our fragment, we must ensure we have all of them.
            // The GUID field is used to identify our envelope containing each fragment. We
            // know we have all fragments when the total size of the fragment == TOT_SIZE.
            //********************************************************************************
      
            // Decode base64 (convert ascii to binary)  
            let fragment = atob(msg.Fields.FRAGMENT);
            
            // Define the news item key - RIC:MRN_SRC:GUID.
            // Used to reference our unique items for envelop management.
            let key = msg.Key.Name + ":" + msg.Fields.MRN_SRC + ":" + msg.Fields.GUID;

            if ( msg.Fields.FRAG_NUM > 1 ) {
                // We are now processing more than one part of an envelope - retrieve the current details
                let envelope = this._getNewsEnvelope(key);
                if ( envelope ) {
                    envelope.fragments = envelope.fragments + fragment;
                    
                    // Check to make sure we have everything.
                    if ( envelope.fragments.length < envelope.totalSize)
                        return;  // No - wait for some more

                    // Yes - process 
                    fragment = envelope.fragments;
      
                    // Remove our envelope 
                    this._deleteNewsEnvelope(key);
                }
            } else if ( fragment.length < msg.Fields.TOT_SIZE) {
                // We don't have all fragments yet - save what we have
                this._setNewsEnvelope(key, {fragments: fragment, totalSize: msg.Fields.TOT_SIZE});
                return;
            }

            // *********************************************************
            // All fragments have been received for this story - process
            // *********************************************************
            
            // Convert binary string to character-number array
            let charArr = fragment.split('').map(function(x){return x.charCodeAt(0);});
            
            // Turn number array into byte-array
            let binArr = new Uint8Array(charArr);

            // Decompress fragments of data and convert to Ascii
            let strData = zlib.pako.inflate(binArr, {to: 'string'});

            // Prepare as JSON object
            let contents = JSON.parse(strData);
            
            // Present our final story to the application
            if ( this.isCallback(this._newsStoryCb) ) this._newsStoryCb(msg.Key.Name, contents);
        }
    }
    catch (e) {
        // Processing error.  Report to our application interface
        console.log(e);
        console.log(msg);
        if ( this.isCallback(this._statusCb) ) this._statusCb(this.status.processingError, e.message);
    }   
}

//********************************************************************************************************* 
// _login
// Once we connect into our Streaming WebSocket server, issue a login request.  The structure of the login
// request is based on whether we are using user/password authentication or the TREP authentication feature
// utilizing an authorization token.
//
// User/Password login request format:
// {
//     "Domain": "Login",
//     "ID": 1,
//     "Key": {
//        "Name": "user",
//        "Elements": {
//           "ApplicationId": "256",
//           "Position": "127.0.0.1"
//     }
// }
//
// TREP Authentication token request format:
// {
//     "Domain": "Login",
//     "ID": 1,
//     "Key": {
//        "NameType": "AuthnToken",
//        "Elements": {
//           "ApplicationId": "256",
//           "Position": "127.0.0.1",
//           "AuthenticationToken": "LOLXYZ"
//     },
//     "Refresh": false // for re-refresh token re-login only
// }
//********************************************************************************************************* 
ERTWebSocketController.prototype._login = function (opt) 
{
    // Prepare the login request
    let login = {
        ID: 0,
        Domain: "Login",
        Key: {
            Elements:   {
                ApplicationId: this._loginParams.appId,
                Position: this._loginParams.position
            }
        }
    };
    
    // Apply authentication-specific properties based on login parameters    
    if (this._loginParams.user != undefined) {
        login.Key["Name"] = this._loginParams.user;
    } else {
        login.Key["NameType"] = "AuthnToken";
        login.Key.Elements["AuthenticationToken"] = this._loginParams.access_token;
        if (opt['is_refresh_token']) login['Refresh'] = false;
    }  

    console.log("Submitting login request:", login);
    
    // Submit to server
    this._send(JSON.stringify(login));
};

//*******************************************************************************
// _pong
// To keep the Elektron WebSocket connection active, we must periodically send a
// notification to the server.  The WebSocket server sends a 'Ping' message and 
// once received, our application acknowldges and sends a 'Pong'. 
//
// JSON request format:
// {
//     "Type": "Pong"
// }
//
//**************************************************************
ERTWebSocketController.prototype._pong = function () 
{
    // Send Pong response
    let pong = {
        Type: "Pong"
    };

    // Submit to server
    this._send(JSON.stringify(pong));
};      

//********************************************************************************************************* 
// _send
// Send a packet of data down our connected WebSocket channel.
//*********************************************************************************************************    
ERTWebSocketController.prototype._send = function (text) 
{
    if (this.ws)
        this.ws.send(text);
};

ERTWebSocketController.prototype.isCallback = function(methodName) { 
    return( (typeof methodName) == "function" ); 
}
