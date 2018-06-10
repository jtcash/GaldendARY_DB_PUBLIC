var intermediate_server = require('./intermediate_server.js');
const restart_delay = 1000;

function start_server_recover(){
  try{
    intermediate_server();
  }catch(e){
    console.error(e);
    setTimeout(start_server_recover, restart_delay);
  }
}

start_server_recover();



// const express = require('express')
// var request_handler = require('./request_handler.js')
// var mysql = require('mysql');
// const config = require('./config.json');


// // Create a MySQL connection pool for dispatching statements to the MySQL server
// // without having to open a new connection for each
// console.log('initializing connection pool');
// var pool  = mysql.createPool({
//   host   : config.dbhost,
//   user   : config.dbuser,
//   password : config.dbpassword,
//   database : config.dbname
// });


// // Create an express object to serve as the node server
// const app = express();
// // Set the express object to redirect requests to the request_handler
// app.get('/', (req, res) => {
//   request_handler(req.query, (err, data) => {
//     if(err){
//       console.log({date: new Date().toISOString(), query: req.query, err: err, data: data});
//       res.send({err: err, data: data});
//     } else {
//       console.log({date: new Date().toISOString(), query: req.query, data: data})
//       res.send(data);
//     }
//     console.log();
//   }, {pool: pool, begin_ms: Date.now() });
// })

// // The port that the server will talk on
// const port = 3000;

// // Start up the server, listening on port
// app.listen(port, () => console.log('Server running on port ' + port));
