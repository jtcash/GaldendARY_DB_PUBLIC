#!/bin/bash
ssh -o ServerAliveInterval=60 -i "$(dirname "$0")/gary-key-pair.pem" ec2-user@ec2-13-57-18-173.us-west-1.compute.amazonaws.com
