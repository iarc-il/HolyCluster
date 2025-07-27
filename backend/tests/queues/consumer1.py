import redis
import time

r = redis.Redis()

def consume(group_name, consumer_name):
    while True:
        resp = r.xreadgroup(group_name, consumer_name, {"mystream": ">"}, count=10, block=5000)
        if resp:
            for stream_name, messages in resp:
                for message_id, message in messages:
                    print(f"[{group_name}] Received {message_id}: {message[b'data'].decode()}")
                    # Acknowledge message so it won't be delivered again
                    r.xack("mystream", group_name, message_id)
        else:
            print(f"[{group_name}] No new messages, waiting...")

if __name__ == "__main__":
    consume(group_name="group1", consumer_name="consumer1")  # For receiver 1
    # Run this also with group_name="group2" and consumer_name="consumer2" for receiver 2

