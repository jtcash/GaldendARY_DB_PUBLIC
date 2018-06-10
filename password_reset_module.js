var nodemailer = require('nodemailer');

const email_address = 'Galendary.Email@gmail.com';
const email_password = 'GoogleGary1';

var transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: email_address,
    pass: email_password
  }
});

function create_passhash_email(email, new_password){
  return {
    from: email_address,
    to: email,
    subject: 'Your GalenDARY password has been reset!',
    text: 'Log in with the following temporary password:\n' + new_password
  };
}

module.exports = (email, new_password, callback) => {
  transporter.sendMail(create_passhash_email(email, new_password), (error, info) => {
    if (error) callback(error);
    callback(null, JSON.stringify({success: true}));
  });
}
