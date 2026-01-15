exports.handleVisitStatus = async (req, res) => {
  try {
    const { eventType, visitId, data } = req.body;

    if (!eventType || !visitId) {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    console.log(`Received event: ${eventType} for Visit ID: ${visitId}`);

    // Handle different event types
    switch (eventType) {
      case 'canceled':
        console.log(`Visit ${visitId} was canceled.`);
        break;
      case 'concluded':
        console.log(`Visit ${visitId} was concluded.`);
        break;
      case 'prescribed':
        console.log(`Visit ${visitId} was prescribed.`);
        break;
      default:
        console.log(`Unknown event type: ${eventType}`);
    }

    res.status(200).json({ success: true, message: 'Event processed successfully' });
  } catch (error) {
    console.error('Error processing event:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
