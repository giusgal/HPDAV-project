import os
import psycopg2
import time
from flask import Flask

app = Flask(__name__)

def get_db_connection():
    # Connect to the database using the service name "db"
    conn = psycopg2.connect(
        host="db",
        database="hpdavDB",
        user="myuser",
        password="mypassword"
    )
    return conn

@app.route('/')
def index():
    start = time.time()

    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute('SELECT * FROM participantstatuslogs LIMIT 100000;')
    res = cur.fetchall()
    
    cur.close()
    conn.close()

    end = time.time()
    
    return f"<p>{end-start}</p>"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
