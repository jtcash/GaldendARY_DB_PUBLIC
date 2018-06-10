var mysql = require('mysql');
// Lib for formatting SQL statements and escaping unsafe characters
var SqlString = require('sqlstring');
// RDS MySQL database information and credentials
var config = require('./config.json');

var crypto = require('crypto');

var validator = require('validator');
var sha1 = require('sha1');




var password_reset_module = require('./password_reset_module.js');



// Get a random string of a specific length and with a specific radix
function get_random_string(length, radix){
  if(typeof radix === 'undefined') radix = 36;
  if(typeof length === 'undefined') length = 10;
  let str = crypto.randomBytes(8).readUInt32LE().toString(radix).substr(1);
  if(str.length < length) str += get_random_string(length - str.length, radix);
  return str.substr(0,length);
}



// A helper function that allows for the lookup and return of object properties
// when that property can have multiple names, or just to get another property
// as a fallback if the first properties don't exist.
Object.prototype.get_property = function(propname, fallbacks){
  for(let i=0; i<arguments.length; ++i)
    if(this.hasOwnProperty(arguments[i]))
      return this[arguments[i]];
}

// Gets a property from an event object and ensures its existence
// Sends an error to callback if the property does not exist
function get_event_property(event, propname, callback){
  if(!event.hasOwnProperty(propname))
    return callback('event requires property "' + propname + '"');
  return event[propname];
}

// Same as get_event_property, but does not require the existence of that property
// returns null if the property does not exist
function get_event_property_optional(event, propname){
  return event.hasOwnProperty(propname) ? event[propname] : null;
}




// A dummy handler for testing simple functionality in case everything breaks
function handle_test(event, callback, context){
  console.log("event : ", event);
  console.log("context:", context);
  // return handle_statement({statement: "SELECT COUNT(*) AS c FROM users;"}, (err, data) => {
  return handle_statement({statement: "SELECT * FROM entries;"}, (err, data) => {
    let str = JSON.stringify(data) + '\n<br/>\n<br/>\n';
    data.forEach((element, index) => {
      str += index + ':\t' + JSON.stringify(element) +'\n<br/>\n';
    });
    console.log(str);
    return callback(null, str);


    // let str = "Node server is up and running\n<br/>\nConnection to database is ";
    // str += (typeof data !== 'undefined' && data[0].c > 0) ? 'up!' : 'down!';
    // return callback(null, str);
  }, context);
  // return callback(null, "handle_test() success\n<br/>\nServer is up and running");
 }




function get_connection_pool(callback, context){
  if(typeof context === 'undefined' || context === null)
    return callback("touch_connection_pool: context must not be undefined or null");
  

  if(!context.hasOwnProperty('pool') || context.pool._closed){
    if(context.pool._closed){
      console.log('Terminating old, closed pool');
      context.pool.end();
    }
    console.log('Creating MySQL connection pool...');
    context.pool = mysql.createPool({
      host   : config.dbhost,
      user   : config.dbuser,
      password : config.dbpassword,
      database : config.dbname
    });
  }
 

  if(context.pool._closed)
    return callback('unrecoverable error: failed to reopen connection pool');
}


//TODO: Pass the return value through a reformatting function before
//returning it to make it easier for handling on the java side

// A handler for SQL statements. Talks to the MySQL server, sending a statement
// and recieving data. Uses pooled MySQL connections to optimize traffic.
function handle_statement(event, callback, context){
  let statement = get_event_property(event, 'statement', callback);

  let pool = get_connection_pool(callback, context);

  if(!context.hasOwnProperty('pool')){
    return callback('fucked up context pool');
  }

  if(context.pool._closed){
    context.pool.end();
    // reopen the pool if it closes for some terrible reason
    // This is a slightly sloppy way to handle this.
    // Maybe put some more thought into this in the future
    console.log('Forced to create new pool due to pool closure.')
    context.pool = mysql.createPool({
      host   : config.dbhost,
      user   : config.dbuser,
      password : config.dbpassword,
      database : config.dbname
    });
  }


  // Use a pooled connection in order to speed up access times by keeping a
  // connection to the database open and using the same connections for multiple
  // queries.
  context.pool.getConnection(function(err, connection) {
  // Use the connection
    connection.query(statement, function (error, results, fields) {
      // And done with this connection; the results are already stored
      connection.release();

      // Handle SQL errors by passing them off to the callback after connection release.
      if(error) return callback(error);
      
      console.log('Executed query in ' + (Date.now() - context.begin_ms) + 'ms');

      // TODO: Figure out if this is the format I wish to return the results in
      // This could potentially make things much easier for the Java side
      // as a json parser will have not problem creating objects from the data.
      // This has the downside that you are transmitting sometimes an order of magnitude
      // more data than is necessary. For now, this should be fine.
      return callback(null, results);
    });
  });
}




// Requires event to contain username and passhash props.
function handle_verify_login(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  
  let statement = SqlString.format(
    "SELECT COUNT(*) AS c FROM users WHERE username = ? AND passhash = ?;"
    , [username, passhash]
  );

  return handle_statement({statement: statement}, (err, data) => {
    if(err) return callback(err);
    return callback(null, data[0].c == 1); 
  }, context);
}

// Add a user into the users table based on username and passhash
function handle_create_user(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);

  let statement = SqlString.format(
    "INSERT INTO users (username, passhash) VALUES (?, ?);",
    [username, passhash]
  );

  return handle_statement({statement: statement}, callback, context);
}

function handle_get_user(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);

  let statement = SqlString.format(
    "SELECT * FROM users WHERE username = ? AND passhash = ?;",
    [username, passhash]
  );

  return handle_statement({statement: statement}, callback, context);
}




function handle_create_group(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  let group_name = get_event_property(event, 'group_name', callback);

  // Call the create_group procedure on the MySQL server.
  let statement = SqlString.format('CALL create_group(?, ?, ?);', [group_name, username, passhash]);

  return handle_statement({statement: statement}, callback, context);
}

function handle_alter_group(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  let group_id = get_event_property(event, 'group_id', callback);


  let group_name = get_event_property_optional(event, 'group_name');
  let is_public = get_event_property_optional(event, 'is_public');
  let looking_for_subgroups = get_event_property_optional(event, 'looking_for_subgroups');

  if(group_name == null && is_public == null && looking_for_subgroups == null){
    return callback("handle_alter_group: Will not alter anything");
  }

  let params = [];

  let statement_str = 'UPDATE groups, users, user_group_join SET groups.name = '
  if(group_name != null){
    params.push(group_name);
    statement_str += '?';
  } else {
    statement_str += 'groups.name';
  }
  statement_str += ', groups.is_public = '
  if(is_public != null){
    params.push(is_public == 'true');
    statement_str += '?'
  } else {
    statement_str += 'groups.is_public';
  }

  statement_str += ', groups.looking_for_subgroups = '
  if(looking_for_subgroups != null){
    paramas.push(looking_for_subgroups == 'true');
    statement_str += '?';
  } else {
    statement_str += 'groups.looking_for_subgroups ';
  }

  statement_str += 'WHERE ' +
  'groups.id = ? AND ' +
  'users.username = ? AND ' +
  'users.passhash = ? AND ' +
  'user_group_join.user_id = users.id AND ' +
  'user_group_join.group_id = groups.id;';

  params.push(group_id);
  params.push(username);
  params.push(passhash);

  console.log({statement_str: statement_str});
  
  let statement = SqlString.format(statement_str, params);
  console.log({statement: statement});

  

  return handle_statement({statement: statement}, callback, context);
}



function handle_change_password(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  let passhash_new = get_event_property(event, 'passhash_new', callback);

  let statement = SqlString.format(
    'CALL change_password(?, ?, ?);',
    [username, passhash, passhash_new]
  );

  return handle_statement({statement: statement}, callback, context);
}

//INSERT INTO entries (id, title, start, end) VALUES (1, 'Gary Lecture', '2018-05-15 14:00', '2018-05-15 15:20');
// create_entry&username=jeff&passhash=not_sha2&group_id=45&title=GARY+MEME+TIME&start_time=2018-06-05+14:00&end_time=2018-06-05+15:20&description=test+meme
// Handles entry creation
function handle_create_entry(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  let group_id = get_event_property(event, 'group_id', callback);
  

  // not all of these are necessary for each entry. Group page is an entry with
  let title =  get_event_property_optional(event, 'title', callback);
  let start_time =  get_event_property_optional(event, 'start_time');
  let end_time =  get_event_property_optional(event, 'end_time');
  let recurrence =  get_event_property_optional(event, 'recurrence');
  let priority = get_event_property_optional(event, 'priority');
  let description = get_event_property_optional(event, 'description');

  let statement = SqlString.format(
    'CALL create_entry(?, ?, ?, ?, ?, ?, ?, ?, ?);',
    [username, passhash, group_id, title, start_time, end_time, recurrence, priority, description]
  );

  return handle_statement({statement: statement}, callback, context);
}

function handle_update_entry(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  let entry_id = get_event_property(event, 'entry_id', callback);
  let title =  get_event_property(event, 'title', callback);

  // not all of these are necessary for each entry. Group page is an entry with
  let start_time =  get_event_property_optional(event, 'start_time');
  let end_time =  get_event_property_optional(event, 'end_time');
  let recurrence =  get_event_property_optional(event, 'recurrence');
  let priority = get_event_property_optional(event, 'priority');
  let description = get_event_property_optional(event, 'description');

  let statement = SqlString.format(
    'CALL update_entry(?, ?, ?, ?, ?, ?, ?, ?, ?);',
    [username, passhash, entry_id, title, start_time, end_time, recurrence, priority, description]
  );

  return handle_statement({statement: statement}, callback, context);
}


function handle_delete_entry(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  let entry_id = get_event_property(event, 'entry_id', callback);

  let statement = SqlString.format(
    'CALL delete_entry(?,?,?);',
    [username, passhash, entry_id]
  );


  return handle_statement({statement: statement}, callback, context);

}

function handle_get_all_entries(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);

  let statement = SqlString.format(
`SELECT groups.id AS gid, entries.* FROM groups, entries, users, user_group_join, group_entry_join
WHERE users.username = ? AND
  users.passhash = ? AND
  user_group_join.user_id = users.id AND
  user_group_join.group_id = groups.id AND
  group_entry_join.group_id = groups.id AND
  group_entry_join.entry_id = entries.id;`,
    [username, passhash]
  );

  return handle_statement({statement: statement}, callback, context);
}





/*
 *Requires event to have a request entry username/id, admin username, 
 *admin passhash, group name, and an accept/decline
 *TODO: fix return values
 */
function handle_request_decision(event, callback, context) {
  let req_id = get_event_property(event, 'request_id', callback);
  let adm_username = get_event_property(event, 'admin_username', callback);
  let adm_passhash = get_event_property(event, 'admin_passhash', callback);
  let group_id = get_event_property(event, 'group_id', callback);
  let decision = get_event_property(event, 'decision', callback);

  /*
   *calls a MySQL Procedure to eihether add the user to the group or only
   *delete their request
   */
  let statement = SqlString.format(
    'CALL request_decision(?, ?, ?, ?, ?);',
    [req_id, adm_username, adm_passhash, group_id, decision]
  );

  return handle_statement({statement: statement}, callback, context);
}

/*
 *Requires username,passhash,group id, and adds a request to join the group
 *TODO: fix return values
 * WORKS!!!!
 */
function handle_create_request(event, callback, context) {
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  let group_id = get_event_property(event, 'group_id', callback);

  //calls MySQL Procedure to add the user and the group into group_requests
  let statement = SqlString.format(
    'INSERT INTO group_requests (user_id, group_id) SELECT users.id,' +
    ' groups.id FROM users, groups WHERE users.username = (?)' +
    ' AND users.passhash = (?) AND groups.id = (?);'
    [username, passhash, group_id]
  );

  return handle_statement({statement: statement}, callback, context);
}

/*
 * Requires a group name and returns all groups with that name
 * WORKS!
 */
 function handle_search_group_name(event, callback, context) {
  let group_name = get_event_property(event, 'group_name', callback);

  //calls MySQL Procedure to find the group ID
  let statement = SqlString.format(
    "SELECT groups.* FROM groups WHERE LOWER(groups.name) LIKE CONCAT('%', LOWER(?), '%') AND groups.is_public = true;",
    [group_name]
  );

  return handle_statement({statement: statement}, callback, context);
}

/*
 *Requires a username and a user passhash
 *Will return all groups one is a member of
 *TODO: fix return values
 *WORKS!!!
 */
function handle_get_all_groups(event, callback, context) {
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);

  let statement = SqlString.format(
    'SELECT groups.*, user_group_join.admin FROM groups,' + 
    ' users, user_group_join WHERE users.username = (?)' +
    ' AND users.passhash = (?) AND user_group_join.user_id = users.id' +
    ' AND user_group_join.group_id = groups.id;',
    [username, passhash]
  );

  return handle_statement({statement: statement}, callback, context);
}

/*
 *requires username and passhash, returns all group requests
 *that an individual may approve
 * WORKS!!!
 */
function handle_get_requests(event, callback, context) {
  let username = get_event_property(event,'username',callback);
  let passhash = get_event_property(event,'passhash',callback);

  let statement = SqlString.format(
    'SELECT group_requests.*' +
    ' FROM group_requests, users, user_group_join' +
    ' WHERE users.passhash = (?) AND users.username = (?)' +
    ' AND users.email = user_group_join.admin_email AND' +
    ' user_group_join.group_id = group_requests.group_id;',
    [passhash,username]
  );

  return handle_statement({statement:statement}, callback, context);
}

//Takes in User ID and returns the users username
function handle_get_username(event, callback, context) {
  let uid = get_event_property(event,'user_id', callback);
  
  let statement = SqlString.format(
    'SELECT users.username FROM users WHERE users.id = (?);',
    [uid]
  );

  return handle_statement({statement:statement}, callback, context);
}

//Takes in a group id and returns the groups name
function handle_get_group_name(event, callback, context) {
  let gid = get_event_property(event,'group_id', context);

  let statement = SqlString.format(
    'SELECT groups.name FROM groups WHERE groups.id = (?);',
    [gid]
  );

  return handle_statement({statement:statement}, callback, context);
}


function handle_get_all_entries_and_groups(event, callback, context){
  return handle_get_all_entries(event, (err, data_entries) => {
    if(err) return callback(err);
    
    return handle_get_all_groups(event, (err, data_groups) => {
      if(err) return callback(err);

      return callback(null, {entries: data_entries, groups: data_groups});
    }, context);
  }, context);
}

//Works
function handle_get_admin_email(event, callback, context) {
  let gid = get_event_property(event,'group_id',context);

  let statement = SqlString.format(
    'SELECT user_group_join.admin_email FROM user_group_join WHERE user_group_join.group_id = (?) AND user_group_join.admin = true;',
    [gid]
  );

  return handle_statement({statement:statement}, callback, context);

}

//updated
function handle_update_admin_email(event,callback,context) {
    let new_email = get_event_property(event,'admin_email',context);
    let gid = get_event_property(event,'group_id',context);
    let uid = get_event_property(event,'user_id',context);

    let statement = SqlString.format(
      'UPDATE user_group_join SET admin_email = [?] WHERE user_group_join.group_id = [?] AND user_group_join.user_id = [?] AND user_group_join.admin = true;',
      [new_email,gid]
    );

    return handle_statement({statement:statement}, callback, context);

}


function handle_generate_enrollment_code(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  let group_id = get_event_property(event, 'group_id', callback);

  let enrollment_code = get_random_string(7, 36);

  let statement = SqlString.format(`
  UPDATE users, groups, user_group_join
  SET groups.enrollment_code = ?
  WHERE groups.id = ? AND
    users.username = ? AND
    users.passhash = ? AND
    user_group_join.user_id = users.id AND
    user_group_join.group_id = groups.id AND
    user_group_join.admin = true;`,
  [enrollment_code, group_id, username, passhash]);


  

  return handle_statement({statement: statement}, (err, data) => {
    if(err) return callback(err);
    if(data.hasOwnProperty('changedRows')){
      if(data.changedRows == 1)
        return callback(null, {enrollment_code: enrollment_code});
      
    }
    return callback({err: "no clue what happened RIP m8"})

  }, context);
  
}



function handle_get_enrollment_code(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  let group_id = parseInt(get_event_property(event, 'group_id', callback));

  let statement = SqlString.format(`
  SELECT groups.enrollment_code FROM groups, users, user_group_join
  WHERE users.username = ? AND
    users.passhash = ? AND
    groups.id = ? AND
    user_group_join.user_id = users.id AND
    user_group_join.group_id = groups.id`,
  [username, passhash, group_id] );


  return handle_statement({statement: statement}, callback, context);
}

function handle_join_group_by_enrollment_code(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);

  let enrollment_code = get_event_property(event, 'enrollment_code', callback);
  

  let statement = SqlString.format(
    `CALL join_group_by_enrollment_code(?, ?, ?)`,
    [username,passhash,enrollment_code]
  );

  return handle_statement({statement:statement}, callback, context);
}

function handle_leave_group(event, callback, context){
  let user_id = get_event_property(event, 'user_id', callback);
  let group_id = parseInt(get_event_property(event, 'group_id', callback));

  let statement = SqlString.format(
    `DELETE FROM user_group_join WHERE user_id = ? AND group_id = ?;`,
    [user_id,group_id]
  );

  return handle_statement({statement:statement}, callback, context);
}



function handle_promote_to_admin(event, callback, context) {
  let user_id = get_event_property(event, 'user_id', callback);
  let group_id = get_event_property(event, 'group_id', callback);

  let statement = SqlString.format(
    'UPDATE user_group_join SET admin = true' +
      ' WHERE user_id = ? AND' +
      ' group_id = ?;',
      [user_id,group_id]
  );

  return handle_statement({statement: statement}, callback, context);
}


function handle_load_group_members(event, callback, context) {
  
  let gid = get_event_property(event, 'group_id', callback);



  let statement = SqlString.format(
    'SELECT users.*' +
    ' FROM users, user_group_join WHERE user_group_join.group_id = ? AND' +
    ' user_group_join.user_id = users.id;',
    [gid]
  );

  return handle_statement({statement: statement}, callback, context);
}

function handle_dissolve_group(event, callback, context) {
  let gid = get_event_property(event, 'group_id', callback);
  let un = get_event_property(event, 'username', callback);
  let ph = get_event_property(event, 'passhash', callback);

  let statement = SqlString.format(
    'CALL delete_group(?, ?, ?);',
    [gid, un, ph]
  );

  return handle_statement({statement: statement}, callback, context);
}





function handle_add_group_to_related(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);

  // Group this user is an admin of
  let group_id_a = parseInt(get_event_property(event, 'group_id_a', callback));

  // Group this user is a member of, to which he will link his group
  let group_id_b = parseInt(get_event_property(event, 'group_id_b', callback));



  let statement = SqlString.format(
    'CALL add_group_to_related(?, ?, ?, ?);',
    [username, passhash, group_id_a, group_id_b]
  );

  return handle_statement({statement: statement}, callback, context);
}


function handle_get_related_groups(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);


  // Group id (b)
  let group_id = parseInt(get_event_property(event, 'group_id', callback));

  let statement = SqlString.format(
    `SELECT groups.id, groups.name, groups.enrollment_code
    FROM users, groups, user_group_join, related_groups
    WHERE users.username = ? AND
      users.passhash = ? AND
      user_group_join.user_id = users.id AND
      user_group_join.group_id = ? AND
      related_groups.id_group_b = user_group_join.group_id AND
      groups.id = related_groups.id_group_a;`,
   [username, passhash, group_id]);


   return handle_statement({statement: statement}, callback, context);
}

function handle_get_events_of_group_members(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);

  let group_id = parseInt(get_event_property(event, 'group_id', callback));
  


  let statement = SqlString.format(
    'CALL get_group_member_entries(?,?,?)',
    [username, passhash, group_id]
  );

  return handle_statement({statement: statement}, callback, context);
}





function handle_reset_password(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  if(!validator.isEmail(username)) return callback("Not valid email: " + username);

  let new_password = get_random_string(10);
  let new_passhash = sha1(new_password);

  let statement = SqlString.format(
    'CALL reset_password(?, ?);',
    [username, new_passhash]
  )


  return handle_statement({statement: statement}, (err, data) => {
    if(err) return callback(err);
    //[[{"success":1}],{"fieldCount":0,"affectedRows":0,"insertId":0,"serverStatus":2,"warningCount":0,"message":"","protocol41":true,"changedRows":0}]

    try{
      if(data[0][0]['success'] == 1)
        return password_reset_module(username, new_password, callback);
          //callback(null, {success: true});
    } catch(e){
      System.err.println("Server issue");
    }

    return callback(null,{success: false});    
    
  }, context)
}


function handle_change_user_display_name(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);
  let display_name = get_event_property(event, 'display_name', callback);

  let statement = SqlString.format(
    `UPDATE users SET name = ? WHERE username = ? AND passhash = ?;`,
    [display_name, username, passhash]
  );

  return handle_statement({statement:statement}, callback, context);
}


function handle_delete_user(event, callback, context){
  let username = get_event_property(event, 'username', callback);
  let passhash = get_event_property(event, 'passhash', callback);

  let statement = SqlString.format(
    `DELETE FROM users WHERE username = ? AND passhash = ?;`,
    [username, passhash]
  );

  return handle_statement({statement: statement}, callback, context);
}




// The main part of the event handler. Will make calls to handle_* functions
// depending on the content of event.
module.exports = (event, callback, context) => {
  // Filter and handle null properties using the NULL_STRING from ParameterBuilder
  for(prop in event){
    if(event[prop] === '{NULL_PLS_NO_USER_TYPE_ME_IN_AS_REAL_VALUE}')
      event[prop] = null;
  }


  // Set up a dummy callback for when testing on local, similar behavior occurs
  if(typeof callback === "undefined"){
    callback = (err, data) => {
      console.log("\nFinal Callback:")
      if(err) console.log("err : ", err);
      console.log("data:", data);
      process.exit();
    }
  }
  // Set up a dummy context so the local and lambda code can have consistency
  if(typeof context === "undefined") context = {dummy_context: true};
  


  let command = event.get_property('c', 'command');
  
  // Pass execution off to one of the handle_*(event, callback, context) functions
  switch(command){
    case 'test': case 't':
      return handle_test(event, callback, context);

    case 'statement': case 's': // TODO remove this from public access
      return handle_statement(event, callback, context);
    
    case 'verify_login': case "v_l":
      return handle_verify_login(event, callback, context);
    
    case 'create_user': case 'c_u':
      return handle_create_user(event, callback, context);

    case 'get_user': case 'g_u':
      return handle_get_user(event, callback, context);

    // case 'alter_user':
    //   return handle_alter_user(event, callback, context);

    case 'create_group': case 'c_g':
      return handle_create_group(event, callback, context);
    
    case 'change_password': case 'c_p':
      return handle_change_password(event, callback, context);

    case 'create_entry': case 'c_e':
      return handle_create_entry(event, callback, context);

    case 'update_entry': case 'u_e':
      return handle_update_entry(event, callback, context);


    case 'delete_entry': case 'd_e':
      return handle_delete_entry(event, callback, context);
    
    case 'get_all_entries': case 'g_a_e':
      return handle_get_all_entries(event, callback, context);

    case 'get_all_entries_and_groups': case "g_a_e_a_g":
      return handle_get_all_entries_and_groups(event, callback, context);


    case 'alter_group':
      return handle_alter_group(event, callback, context);


    case 'generate_enrollment_code':
      return handle_generate_enrollment_code(event, callback, context);
    case 'get_enrollment_code':
      return handle_get_enrollment_code(event, callback, context);

    case 'join_group_by_enrollment_code':
      return handle_join_group_by_enrollment_code(event, callback, context);

    case 'leave_group':
      return handle_leave_group(event, callback, context);


    case 'create_request' : case 'c_r' :
      return handle_create_request(event, callback, context);

    case 'respond_request' : case 'r_r' :
      return handle_request_decision(event, callback, context);

    case 'search_group_name' : case 's_g_n' :
      return handle_search_group_name(event, callback, context);

    case 'get_all_groups' : case 'g_a_g' :
      return handle_get_all_groups(event, callback, context);

    case 'get_requests' : case 'g_r' :
      return handle_get_requests(event, callback, context); 

    case 'get_username' : case 'g_u' :
      return handle_get_username(event, callback, context);

    case 'get_group_name' : case 'g_g_n' :
      return handle_get_group_name(event, callback, context);

    case 'get_admin_email' : case 'g_a_e' :
      return handle_get_admin_email(event, callback, context);

    case 'add_admin_email' : case 'a_a_e' :
      return handle_add_admin_email(event, callback, context);

    case 'promote_to_admin' : case 'p_t_a' :
      return handle_promote_to_admin(event, callback, context);

    case 'load_group_members' : case 'l_g_m' :
      return handle_load_group_members(event, callback, context);

    case 'dissolve_group' : case 'd_g' :
      return handle_dissolve_group(event, callback, context);
      


    /* New stuff pertaining to related groups */
    case 'add_group_to_related':
      return handle_add_group_to_related(event, callback, context);


    // TODO:
    case 'remove_group_from_related':
      return handle_statement({statement:"SELECT 'todo';"}, callback, context);
      // return handle_remove_group_from_related(event, callback, context);

    case 'get_related_groups':
      return handle_get_related_groups(event, callback, context);

    case 'get_events_of_group_members':
      return handle_get_events_of_group_members(event, callback, context);


  
    case 'change_user_display_name':
      return handle_change_user_display_name(event, callback, context);

    

    case 'reset_password':
      return handle_reset_password(event, callback, context);

      
    case 'delete_user':
      return handle_delete_user(event, callback, context);
    


    case '':
      return callback('no command given');
  }

  return callback('invalid command');
}


/// SELECT groups.name FROM users, groups, user_group_join WHERE username = 'jeff' AND pass_sha1 = 'not_sha' AND user_id = users.id AND groups.id = group_id;

// Grab all the entries for a specific user while verifying login credentials
// SELECT groups.id, groups.name, entries.title, entries.start, entries.end FROM users, groups, user_group_join, group_entry_join, entries WHERE username = 'jeff' AND pass_sha1 = 'not_sha1' AND user_id = users.id AND groups.id = user_group_join.group_id AND entry_id = entries.id;
