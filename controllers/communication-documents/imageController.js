import { s3Client } from '../../utils/s3.js';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as s3GetSignedUrl } from '@aws-sdk/s3-request-presigner';
import User from '../../models/account/users.js'; // Adjust the path based on your user model location

export const uploadProfileImage = async (req, res) => {
  try {
    if (!req.fileData) {
      return res
        .status(400)
        .json({ success: false, message: 'No image uploaded' });
    }

    const { userId } = req.body;

    // Find user and update their profile image
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // If user already has a profile image, try to delete it but continue even if deletion fails
    if (user.profileImageKey) {
      try {
        await deleteFileFromS3(user.profileImageKey);
      } catch (deleteError) {
        // Log error but continue with upload
        console.error(
          'Error deleting old image, continuing with upload:',
          deleteError.message
        );
        // We don't want to stop the upload just because deletion failed
      }
    }

    // Update user with new image details
    const key = req.fileData.key;
    user.profileImageKey = key;

    // Direct public URL since bucket is now public
    const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    user.profileImageUrl = imageUrl;
    await user.save();
    return res.status(200).json({
      success: true,
      message: 'Profile image uploaded successfully',
      imageUrl: user.profileImageUrl,
    });
  } catch (error) {
    console.error('Error uploading profile image:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading profile image',
      error: error.message,
    });
  }
};

export const getProfileImage = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required',
      });
    }
    // Get the user to find their profile image key
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (!user.profileImageKey) {
      // Return default image instead of 404 error
      // const defaultImageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/default-profile.png`;

      return res.status(200).json({
        success: true,
        imageUrl: null,
        isDefault: true,
      });
    }
    // Check if the file actually exists in S3
    try {
      const exists = await checkFileExists(user.profileImageKey);
      if (!exists) {
        // Return default image since the actual image is missing
        const defaultImageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/default-profile.png`;

        return res.status(200).json({
          success: true,
          imageUrl: defaultImageUrl,
          isDefault: true,
          reason: 'Original image not found in S3',
        });
      }
    } catch (checkError) {
      console.error('Error checking if file exists:', checkError);
      // Continue anyway, we'll try to use the URL we have
    }

    // With public bucket, we can redirect to the direct URL
    const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${user.profileImageKey}`;
    return res.status(200).json({
      success: true,
      imageUrl,
    });
  } catch (error) {
    console.error('Error getting profile image:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving profile image',
      error: error.message,
    });
  }
};

// Function to get multiple users' profile images at once
export const getBulkProfileImages = async (req, res) => {
  try {
    const { userIds } = req.body; // Array of user IDs

    if (!userIds || !Array.isArray(userIds)) {
      return res.status(400).json({
        success: false,
        message: 'userIds array is required',
      });
    }
    // Default placeholder image
    const defaultImageUrl =
      process.env.DEFAULT_PROFILE_IMAGE ||
      `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/default-profile.png`;

    const users = await User.find({ _id: { $in: userIds } });
    // Create map of user IDs to found users for faster lookup
    const userMap = new Map();
    users.forEach((user) => userMap.set(user._id.toString(), user));

    const imageUrls = userIds.map((userId) => {
      const user = userMap.get(userId.toString());

      if (!user) {
        return {
          userId,
          imageUrl: defaultImageUrl,
          status: 'user_not_found',
        };
      }

      if (!user.profileImageKey) {
        return {
          userId: user._id,
          imageUrl: defaultImageUrl,
          status: 'no_image',
        };
      }

      // Direct URL with public bucket
      const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${user.profileImageKey}`;

      return {
        userId: user._id,
        imageUrl,
        status: 'found',
      };
    });

    return res.status(200).json({
      success: true,
      images: imageUrls,
    });
  } catch (error) {
    console.error('Error getting bulk profile images:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving profile images',
      error: error.message,
    });
  }
};

// Delete a user's profile image
export const deleteProfileImage = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // If user has a profile image, delete it
    if (user.profileImageKey) {
      await deleteFileFromS3(user.profileImageKey);

      // Update user
      user.profileImageKey = null;
      user.profileImageUrl = null;
      await user.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Profile image deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting profile image:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting profile image',
      error: error.message,
    });
  }
};

// Update a user's profile image
export const updateProfileImage = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!req.fileData) {
      return res.status(400).json({
        success: false,
        message: 'No image uploaded',
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Delete old image if it exists, but continue even if deletion fails
    if (user.profileImageKey) {
      try {
        await deleteFileFromS3(user.profileImageKey);
      } catch (deleteError) {
        console.error(
          `Error deleting old image (${user.profileImageKey}), continuing with update:`,
          deleteError.message
        );
        // Don't halt the update just because deletion failed
      }
    }

    // Update with new image
    user.profileImageKey = req.fileData.key;
    user.profileImageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${req.fileData.key}`;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile image updated successfully',
      imageUrl: user.profileImageUrl,
    });
  } catch (error) {
    console.error('Error updating profile image:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating profile image',
      error: error.message,
    });
  }
};

// Helper function to check if a file exists in S3
const checkFileExists = async (key) => {
  try {
    await s3Client.send(
      new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
};

// Helper function to delete a file from S3
const deleteFileFromS3 = async (key) => {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    throw error;
  }
};
